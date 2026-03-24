param(
  [string]$Message
)
$ErrorActionPreference = 'SilentlyContinue'
try { Set-Location (Split-Path -Parent $PSScriptRoot) } catch {}
try { npm test } catch {}
$configPath = Join-Path (Get-Location) "prototype\js\config.js"
$version = ""
if (Test-Path $configPath) {
  $text = Get-Content $configPath -Raw
  if ($text -match "config\.APP_VERSION\s*=\s*'([^']+)'") {
    $current = $Matches[1]
    if ($current -match "^(\d+)\.(\d+)$") {
      $maj = [int]$Matches[1]
      $min = ([int]$Matches[2]) + 1
      $next = "$maj.$min"
    } else {
      $next = "$current.1"
    }
    $text = $text -replace "config\.APP_VERSION\s*=\s*'[^']+'", "config.APP_VERSION = '$next'"
    Set-Content -Path $configPath -Value $text -Encoding UTF8
    $version = $next
  }
}
git add -A | Out-Null
if (-not $Message -or $Message.Trim().Length -eq 0) {
  if ($version) { $Message = "규정 자동 푸시: 테스트와 버전 $version 반영" } else { $Message = "규정 자동 푸시: 테스트 후 변경사항 반영" }
}
git commit -m $Message | Out-Null
git push origin main | Out-Null
Write-Output "Pushed with version $version"
