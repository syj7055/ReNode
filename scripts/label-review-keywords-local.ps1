param(
  [string]$InputPath = "resources/reviews_preprocessed.csv",
  [string]$OutputPath = "resources/reviews_preprocessed.csv",
  [string]$ColumnName = "ai_keywords"
)

$ErrorActionPreference = "Stop"

function U([string]$Escaped) {
  return [System.Text.RegularExpressions.Regex]::Unescape($Escaped)
}

$K_HONBAP = U '\uD63C\uBC25'
$K_PARKING = U '\uC8FC\uCC28\uAC00\uB2A5'
$K_GROUP_SEAT = U '\uB2E8\uCCB4\uC11D'
$K_RESV_EASY = U '\uC608\uC57D\uD3B8\uB9AC'
$K_GOOD_TALK = U '\uB300\uD654\uD558\uAE30\uC88B\uC740'
$K_VALUE = U '\uAC00\uC131\uBE44'
$K_KIND = U '\uCE5C\uC808\uD55C'
$K_CLEAN = U '\uCCAD\uACB0\uD55C'

$TOK_HONBAP = @((U '\uD63C\uBC25'), (U '\uD63C\uC790'), (U '1\uC778'), (U '\uD63C\uC220'))

$TOK_PARKING = @((U '\uC8FC\uCC28'), (U '\uC8FC\uCC28\uC7A5'))

$TOK_GROUP = @((U '\uB2E8\uCCB4\uC11D'), (U '\uB2E8\uCCB4'), (U '\uBAA8\uC784'), (U '\uD68C\uC2DD'), (U '\uAC00\uC871\uBAA8\uC784'))

$TOK_RESV = @(
  (U '\uC608\uC57D \uD6C4 \uC774\uC6A9'),
  (U '\uC608\uC57D\uD558\uACE0'),
  (U '\uC608\uC57D\uD574\uC11C'),
  (U '\uC608\uC57D\uD558\uACE0 \uBC29\uBB38'),
  (U '\uC608\uC57D \uD544\uC218'),
  (U '\uC608\uC57D \uCD94\uCC9C'),
  (U '\uC608\uC57D\uC744 \uD558\uB294\uAC8C \uC88B'),
  (U '\uC608\uC57D\uD3B8\uB9AC')
)

$TOK_RESV_NEGATIVE = @((U '\uC608\uC57D \uC5C6\uC774 \uC774\uC6A9'))

$TOK_TALK = @((U '\uB300\uD654'), (U '\uC870\uC6A9'), (U '\uC544\uB291'), (U '\uCC28\uBD84'), (U '\uBD84\uC704\uAE30'))

$TOK_VALUE = @((U '\uAC00\uC131\uBE44'), (U '\uAC00\uACA9\uB300\uBE44'), (U '\uC800\uB834'), (U '\uD569\uB9AC\uC801'))

$TOK_KIND = @((U '\uCE5C\uC808'), (U '\uC11C\uBE44\uC2A4'), (U '\uC751\uB300'), (U '\uBC30\uB824'))

$TOK_CLEAN = @((U '\uCCAD\uACB0'), (U '\uAE68\uB057'), (U '\uAE54\uB054'), (U '\uC704\uC0DD'), (U '\uC815\uAC08'))

function Normalize-Text([string]$Text) {
  if ($null -eq $Text) {
    return ""
  }

  $foldMarker = [string]::Concat([char]0xC811, [char]0xAE30)
  $normalized = [string]$Text
  $normalized = $normalized.Replace($foldMarker, "")
  $normalized = $normalized -replace "\r", " "
  $normalized = $normalized -replace "\n", " "
  $normalized = $normalized -replace "\s+", " "
  return $normalized.Trim()
}

function Contains-AnyToken([string]$Text, [string[]]$Tokens) {
  foreach ($token in $Tokens) {
    if (-not [string]::IsNullOrWhiteSpace($token) -and $Text.Contains($token)) {
      return $true
    }
  }
  return $false
}

function Add-UniqueLabel([System.Collections.Generic.List[string]]$Labels, [string]$Label) {
  if (-not $Labels.Contains($Label)) {
    [void]$Labels.Add($Label)
  }
}

$resolvedInput = (Resolve-Path $InputPath).Path
$resolvedOutput = if (Test-Path $OutputPath) { (Resolve-Path $OutputPath).Path } else { (Join-Path (Get-Location) $OutputPath) }

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
  $backupPath = "$resolvedInput.bak_local_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
  Copy-Item -Path $resolvedInput -Destination $backupPath -Force
  Write-Host "[backup] $backupPath"
}

$updated = 0

for ($i = 0; $i -lt $rows.Count; $i++) {
  $row = $rows[$i]

  $reviewText = Normalize-Text ([string]$row.review_text)
  $keywordText = Normalize-Text ([string]$row.keywords)
  $visitInfoText = Normalize-Text ([string]$row.visit_info)

  # Semantic quality labels are inferred from user-written review text first.
  $combinedSemantic = Normalize-Text ("$reviewText $keywordText")
  # visit_info is used only for explicit visit attributes like solo intent.
  $combinedVisit = Normalize-Text ("$visitInfoText")

  $labels = New-Object System.Collections.Generic.List[string]

  if (([string]$row.solo_dining) -eq "1" -or (Contains-AnyToken $combinedSemantic $TOK_HONBAP) -or (Contains-AnyToken $combinedVisit $TOK_HONBAP)) {
    Add-UniqueLabel $labels $K_HONBAP
  }

  if (Contains-AnyToken $combinedSemantic $TOK_PARKING) {
    Add-UniqueLabel $labels $K_PARKING
  }

  if (Contains-AnyToken $combinedSemantic $TOK_GROUP) {
    Add-UniqueLabel $labels $K_GROUP_SEAT
  }

  $hasResvPositive = Contains-AnyToken $combinedSemantic $TOK_RESV
  $hasResvNegativeOnly = (Contains-AnyToken $combinedSemantic $TOK_RESV_NEGATIVE) -and (-not $hasResvPositive)
  if ($hasResvPositive -and (-not $hasResvNegativeOnly)) {
    Add-UniqueLabel $labels $K_RESV_EASY
  }

  if (Contains-AnyToken $combinedSemantic $TOK_TALK) {
    Add-UniqueLabel $labels $K_GOOD_TALK
  }

  if (Contains-AnyToken $combinedSemantic $TOK_VALUE) {
    Add-UniqueLabel $labels $K_VALUE
  }

  if (Contains-AnyToken $combinedSemantic $TOK_KIND) {
    Add-UniqueLabel $labels $K_KIND
  }

  if (Contains-AnyToken $combinedSemantic $TOK_CLEAN) {
    Add-UniqueLabel $labels $K_CLEAN
  }

  $uniqueOrdered = @($labels | Select-Object -Unique)
  $row.$ColumnName = ($uniqueOrdered -join "|")
  $updated += 1

  if (($updated % 500) -eq 0) {
    Write-Host "[progress] $updated / $($rows.Count)"
  }
}

$rows | Export-Csv -Path $resolvedOutput -NoTypeInformation -Encoding UTF8
Write-Host "[done] Local keyword labeling finished."
Write-Host "[stats] rows=$($rows.Count), updated=$updated, column=$ColumnName"

