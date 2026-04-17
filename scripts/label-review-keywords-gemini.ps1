param(
  [string]$ApiKey,
  [string]$InputPath = "resources/reviews_preprocessed.csv",
  [string]$OutputPath = "resources/reviews_preprocessed.csv",
  [string]$ColumnName = "ai_keywords",
  [string]$Model = "gemini-2.5-flash",
  [int]$BatchSize = 5,
  [int]$SleepMs = 5000,
  [int]$SaveEveryBatches = 2,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
  throw "ApiKey is required."
}

function U([string]$Escaped) {
  return [System.Text.RegularExpressions.Regex]::Unescape($Escaped)
}

$AllowedKeywords = @(
  U '\uD63C\uBC25',
  U '\uC8FC\uCC28\uAC00\uB2A5',
  U '\uB2E8\uCCB4\uC11D',
  U '\uC608\uC57D\uD3B8\uB9AC',
  U '\uB300\uD654\uD558\uAE30\uC88B\uC740',
  U '\uAC00\uC131\uBE44',
  U '\uCE5C\uC808\uD55C',
  U '\uCCAD\uACB0\uD55C'
)

$AllowedLookup = @{}
foreach ($k in $AllowedKeywords) { $AllowedLookup[$k] = $true }

function Normalize-Text([string]$Text) {
  if ($null -eq $Text) { return "" }
  $foldMarker = [string]::Concat([char]0xC811, [char]0xAE30)
  $x = [string]$Text
  $x = $x.Replace($foldMarker, "")
  $x = $x -replace "\r", " "
  $x = $x -replace "\n", " "
  $x = $x -replace "\s+", " "
  return $x.Trim()
}

function To-SafeJsonObject {
  param([string]$raw)

  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $null
  }

  $txt = $raw.Trim()
  if ($txt.StartsWith('```')) {
    $txt = $txt -replace '^```[a-zA-Z]*', ''
    $txt = $txt -replace '```$', ''
    $txt = $txt.Trim()
  }

  try {
    return ($txt | ConvertFrom-Json)
  }
  catch {
    return $null
  }
}

function Invoke-GeminiBatch {
  param(
    [string]$Key,
    [string]$ModelName,
    [array]$Items
  )

  $allowedText = ($AllowedKeywords -join ", ")

  $systemText = @"
You are a strict Korean review keyword labeler.
Return JSON only.
Only choose from allowed keywords.
If uncertain, return empty list.
Allowed keywords: $allowedText
"@

  $inputPayload = @()
  foreach ($it in $Items) {
    $inputPayload += [ordered]@{
      idx = $it.idx
      text = $it.text
    }
  }

  $userText = @"
Classify each review into keywords.
Return exactly this JSON shape:
{"results":[{"idx":0,"keywords":["..."],"reason":"..."}]}

Rules:
- Keep keywords concise and evidence-based.
- keywords must be from allowed list only.
- reason should be very short.

Input:
$($inputPayload | ConvertTo-Json -Depth 6 -Compress)
"@

  $responseSchema = @{
    type = "OBJECT"
    required = @("results")
    properties = @{
      results = @{
        type = "ARRAY"
        items = @{
          type = "OBJECT"
          required = @("idx", "keywords")
          properties = @{
            idx = @{ type = "INTEGER" }
            keywords = @{
              type = "ARRAY"
              items = @{
                type = "STRING"
                enum = $AllowedKeywords
              }
            }
            reason = @{ type = "STRING" }
          }
        }
      }
    }
  }

  $bodyObj = @{
    systemInstruction = @{ parts = @(@{ text = $systemText }) }
    contents = @(@{ role = "user"; parts = @(@{ text = $userText }) })
    generationConfig = @{
      temperature = 0
      responseMimeType = "application/json"
      responseSchema = $responseSchema
    }
  }

  $body = $bodyObj | ConvertTo-Json -Depth 20
  $uri = "https://generativelanguage.googleapis.com/v1beta/models/$ModelName`:generateContent?key=$Key"

  $resp = Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json" -Body $body -TimeoutSec 180
  $text = [string]$resp.candidates[0].content.parts[0].text
  return (To-SafeJsonObject $text)
}

function Invoke-GeminiBatchWithRetry {
  param(
    [string]$Key,
    [string]$ModelName,
    [array]$Items,
    [int]$MaxAttempts = 6
  )

  $last = $null
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      $obj = Invoke-GeminiBatch -Key $Key -ModelName $ModelName -Items $Items
      if ($null -eq $obj -or $null -eq $obj.results) {
        throw "Invalid JSON response from Gemini."
      }
      return $obj
    }
    catch {
      $last = $_
      if ($attempt -lt $MaxAttempts) {
        $baseDelay = [Math]::Pow(2, $attempt) * 1000
        $jitter = Get-Random -Minimum 0 -Maximum 1000
        $delayMs = [int]([Math]::Min(60000, $baseDelay + $jitter))
        Write-Warning "[retry] attempt=$attempt/$MaxAttempts, wait=${delayMs}ms, reason=$($_.Exception.Message)"
        Start-Sleep -Milliseconds $delayMs
      }
    }
  }

  throw $last
}

function Save-CsvWithRetry {
  param(
    [array]$Data,
    [string]$Path,
    [int]$MaxAttempts = 6
  )

  $dir = Split-Path -Parent $Path
  $tmp = Join-Path $dir ("." + [System.IO.Path]::GetFileName($Path) + ".tmp")
  $last = $null

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      $Data | Export-Csv -Path $tmp -NoTypeInformation -Encoding UTF8
      if (Test-Path $Path) {
        Remove-Item -Path $Path -Force
      }
      Move-Item -Path $tmp -Destination $Path
      return
    }
    catch {
      $last = $_
      if (Test-Path $tmp) {
        Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue
      }
      if ($attempt -lt $MaxAttempts) {
        $delayMs = [int]([Math]::Min(10000, (1000 * $attempt) + (Get-Random -Minimum 0 -Maximum 700)))
        Write-Warning "[save-retry] attempt=$attempt/$MaxAttempts, wait=${delayMs}ms, reason=$($_.Exception.Message)"
        Start-Sleep -Milliseconds $delayMs
      }
    }
  }

  throw $last
}

$resolvedInput = (Resolve-Path $InputPath).Path
$resolvedOutput = if (Test-Path $OutputPath) { (Resolve-Path $OutputPath).Path } else { (Join-Path (Get-Location) $OutputPath) }

Write-Host "[info] Input=$resolvedInput"
Write-Host "[info] Output=$resolvedOutput"
Write-Host "[info] Model=$Model"
Write-Host "[info] BatchSize=$BatchSize"

$rows = Import-Csv -Path $resolvedInput -Encoding UTF8
if ($rows.Count -eq 0) {
  throw "No rows found in CSV."
}

if (-not ($rows[0].PSObject.Properties.Name -contains $ColumnName)) {
  foreach ($row in $rows) {
    Add-Member -InputObject $row -NotePropertyName $ColumnName -NotePropertyValue ""
  }
}

if ($resolvedInput -eq $resolvedOutput) {
  $backup = "$resolvedInput.bak_gemini_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  Copy-Item -Path $resolvedInput -Destination $backup -Force
  Write-Host "[backup] $backup"
}

$targetIndices = New-Object System.Collections.Generic.List[int]
for ($i = 0; $i -lt $rows.Count; $i++) {
  $existing = [string]$rows[$i].$ColumnName
  if ($Force -or [string]::IsNullOrWhiteSpace($existing)) {
    [void]$targetIndices.Add($i)
  }
}

$totalTargets = $targetIndices.Count
if ($totalTargets -eq 0) {
  Write-Host "[done] No target rows to label."
  exit 0
}

$stats = [ordered]@{
  totalRows = $rows.Count
  targetRows = $totalTargets
  updated = 0
  batches = 0
  apiCalls = 0
  failedBatches = 0
}

for ($offset = 0; $offset -lt $totalTargets; $offset += $BatchSize) {
  $count = [Math]::Min($BatchSize, $totalTargets - $offset)
  $batchRowIdx = $targetIndices.GetRange($offset, $count)

  $items = @()
  for ($j = 0; $j -lt $batchRowIdx.Count; $j++) {
    $rowIndex = $batchRowIdx[$j]
    $text = Normalize-Text ([string]$rows[$rowIndex].review_text)
    if ($text.Length -gt 700) {
      $text = $text.Substring(0, 700)
    }

    $items += [ordered]@{
      idx = $j
      rowIndex = $rowIndex
      text = $text
    }
  }

  $stats.batches += 1
  $responseObj = $null

  try {
    $responseObj = Invoke-GeminiBatchWithRetry -Key $ApiKey -ModelName $Model -Items $items
    $stats.apiCalls += 1
  }
  catch {
    $stats.failedBatches += 1
    Write-Warning "[batch $($stats.batches)] failed: $($_.Exception.Message)"
    continue
  }

  $map = @{}
  foreach ($res in $responseObj.results) {
    $map[[int]$res.idx] = @($res.keywords)
  }

  foreach ($it in $items) {
    $keywords = @()
    if ($map.ContainsKey($it.idx)) {
      $keywords = @($map[$it.idx] | ForEach-Object { [string]$_ } | Where-Object { $AllowedLookup.ContainsKey($_) } | Select-Object -Unique)
    }

    $rows[$it.rowIndex].$ColumnName = ($keywords -join "|")
    $stats.updated += 1
  }

  if (($stats.batches % $SaveEveryBatches) -eq 0) {
    Save-CsvWithRetry -Data $rows -Path $resolvedOutput
    Write-Host "[progress] batches=$($stats.batches), updated=$($stats.updated)/$totalTargets"
  }

  Start-Sleep -Milliseconds $SleepMs
}

Save-CsvWithRetry -Data $rows -Path $resolvedOutput
Write-Host "[done] Gemini labeling completed."
$stats.GetEnumerator() | ForEach-Object { Write-Host "[stats] $($_.Key)=$($_.Value)" }
