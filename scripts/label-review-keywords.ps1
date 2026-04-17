param(
  [string]$InputPath = "resources/reviews_preprocessed.csv",
  [string]$OutputPath = "resources/reviews_preprocessed.csv",
  [string]$ColumnName = "ai_keywords",
  [string]$Model = "gpt-4.1-mini",
  [int]$StartIndex = 0,
  [int]$Limit = 0,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) {
  throw "OPENAI_API_KEY environment variable is missing."
}

$allowedKeywords = ConvertFrom-Json '["\uD63C\uBC25","\uC8FC\uCC28\uAC00\uB2A5","\uB2E8\uCCB4\uC11D","\uC608\uC57D\uD3B8\uB9AC","\uB300\uD654\uD558\uAE30\uC88B\uC740","\uAC00\uC131\uBE44","\uCE5C\uC808\uD55C","\uCCAD\uACB0\uD55C"]'
$foldMarker = [string]::Concat([char]0xC811, [char]0xAE30)

$allowedLookup = @{}
foreach ($k in $allowedKeywords) {
  $allowedLookup[$k] = $true
}

function Normalize-ReviewText {
  param([string]$Text)

  $normalized = [string]$Text
  $normalized = $normalized -replace [Regex]::Escape($foldMarker), ""
  $normalized = $normalized -replace "\r", " "
  $normalized = $normalized -replace "\n", " "
  $normalized = $normalized -replace "\s+", " "
  return $normalized.Trim()
}

function Get-TextHash {
  param([string]$Text)

  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $hash = $sha.ComputeHash($bytes)
    return [Convert]::ToBase64String($hash)
  }
  finally {
    $sha.Dispose()
  }
}

function Invoke-KeywordClassification {
  param(
    [string]$ReviewText,
    [string]$ModelName,
    [string[]]$Allowed
  )

  $schema = @{
    type = "object"
    additionalProperties = $false
    required = @("keywords")
    properties = @{
      keywords = @{
        type = "array"
        items = @{
          type = "string"
          enum = $Allowed
        }
        uniqueItems = $true
        maxItems = 6
      }
    }
  }

  $systemPrompt = @"
You are a Korean review keyword labeler.
Only choose from the allowed keywords.
Do not guess. Exclude uncertain labels.
Return exactly one JSON object only.
Allowed keywords: $($Allowed -join ", ")
"@

  $userPrompt = @"
Read the review and return matching keywords only.
If no keyword is clearly supported, return an empty array.

Review:
$ReviewText
"@

  $payload = @{
    model = $ModelName
    temperature = 0
    messages = @(
      @{ role = "system"; content = $systemPrompt },
      @{ role = "user"; content = $userPrompt }
    )
    response_format = @{
      type = "json_schema"
      json_schema = @{
        name = "review_keywords"
        strict = $true
        schema = $schema
      }
    }
  } | ConvertTo-Json -Depth 20

  $headers = @{
    "Authorization" = "Bearer $($env:OPENAI_API_KEY)"
    "Content-Type"  = "application/json"
  }

  $response = Invoke-RestMethod -Uri "https://api.openai.com/v1/chat/completions" -Method Post -Headers $headers -Body $payload -TimeoutSec 180
  $content = [string]$response.choices[0].message.content

  if ([string]::IsNullOrWhiteSpace($content)) {
    throw "Model returned empty content."
  }

  $parsed = $content | ConvertFrom-Json
  if ($null -eq $parsed.keywords) {
    throw "Model response does not contain keywords field."
  }

  $keywords = @($parsed.keywords | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $keywords = @($keywords | Where-Object { $allowedLookup.ContainsKey($_) } | Select-Object -Unique)

  return $keywords
}

function Invoke-KeywordClassificationWithRetry {
  param(
    [string]$ReviewText,
    [string]$ModelName,
    [string[]]$Allowed,
    [int]$MaxAttempts = 3
  )

  $lastError = $null

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      return Invoke-KeywordClassification -ReviewText $ReviewText -ModelName $ModelName -Allowed $Allowed
    }
    catch {
      $lastError = $_
      if ($attempt -lt $MaxAttempts) {
        Start-Sleep -Seconds (2 * $attempt)
      }
    }
  }

  throw $lastError
}

$resolvedInput = (Resolve-Path $InputPath).Path
$resolvedOutput = if (Test-Path $OutputPath) { (Resolve-Path $OutputPath).Path } else { (Join-Path (Get-Location) $OutputPath) }

Write-Host "[info] Input  : $resolvedInput"
Write-Host "[info] Output : $resolvedOutput"
Write-Host "[info] Column : $ColumnName"
Write-Host "[info] Model  : $Model"

$records = Import-Csv -Path $resolvedInput -Encoding UTF8
if ($records.Count -eq 0) {
  throw "No rows found in CSV."
}

$reviewTextColumn = "review_text"
if (-not ($records[0].PSObject.Properties.Name -contains $reviewTextColumn)) {
  throw "review_text column not found."
}

if (-not ($records[0].PSObject.Properties.Name -contains $ColumnName)) {
  foreach ($row in $records) {
    Add-Member -InputObject $row -NotePropertyName $ColumnName -NotePropertyValue ""
  }
}

if ($resolvedInput -eq $resolvedOutput) {
  $backupPath = "$resolvedInput.bak_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  Copy-Item -Path $resolvedInput -Destination $backupPath -Force
  Write-Host "[backup] $backupPath"
}

$total = $records.Count
$start = [Math]::Max(0, $StartIndex)
$endExclusive = if ($Limit -gt 0) { [Math]::Min($total, $start + $Limit) } else { $total }

$cache = @{}
$stats = [ordered]@{
  totalRows = $total
  targetedRows = ($endExclusive - $start)
  updated = 0
  skippedExisting = 0
  skippedEmptyText = 0
  cacheHits = 0
  apiCalls = 0
  errors = 0
}

for ($i = $start; $i -lt $endExclusive; $i++) {
  $row = $records[$i]
  $existing = [string]$row.$ColumnName

  if (-not $Force -and -not [string]::IsNullOrWhiteSpace($existing)) {
    $stats.skippedExisting += 1
    continue
  }

  $reviewText = Normalize-ReviewText -Text ([string]$row.$reviewTextColumn)

  if ([string]::IsNullOrWhiteSpace($reviewText)) {
    $row.$ColumnName = ""
    $stats.skippedEmptyText += 1
    continue
  }

  $hash = Get-TextHash -Text $reviewText
  $keywords = $null

  if ($cache.ContainsKey($hash)) {
    $keywords = $cache[$hash]
    $stats.cacheHits += 1
  }
  else {
    try {
      $keywords = Invoke-KeywordClassificationWithRetry -ReviewText $reviewText -ModelName $Model -Allowed $allowedKeywords
      $cache[$hash] = $keywords
      $stats.apiCalls += 1
    }
    catch {
      $stats.errors += 1
      Write-Warning "[row $i] classification failed: $($_.Exception.Message)"
      $keywords = @()
      $cache[$hash] = $keywords
    }
  }

  $row.$ColumnName = ($keywords -join "|")
  $stats.updated += 1

  if (($stats.updated % 20) -eq 0) {
    Write-Host "[progress] updated=$($stats.updated), apiCalls=$($stats.apiCalls), row=$i/$($endExclusive - 1)"
  }
}

$records | Export-Csv -Path $resolvedOutput -NoTypeInformation -Encoding UTF8

Write-Host "[done] CSV keyword labeling completed."
$stats.GetEnumerator() | ForEach-Object { Write-Host "[stats] $($_.Key)=$($_.Value)" }
