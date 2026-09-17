$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$connectorInstallRoot = Join-Path $env:LOCALAPPDATA 'NKStudio\ImageConnector'
New-Item -ItemType Directory -Force -Path $connectorInstallRoot | Out-Null

# Install a private runtime; do not replace the user's PATH or Node installation.
$connectorNodeVersion = 'v24.21.0'
$connectorArchitecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$connectorArchiveName = "node-$connectorNodeVersion-win-$connectorArchitecture.zip"
$connectorRuntimeRoot = Join-Path $connectorInstallRoot "node-$connectorNodeVersion-win-$connectorArchitecture"
$connectorNode = Join-Path $connectorRuntimeRoot 'node.exe'
if (-not (Test-Path -LiteralPath $connectorNode)) {
    Write-Host '필요한 연결 프로그램을 준비하고 있습니다 / Preparing the image connector...'
    $connectorArchive = Join-Path $connectorInstallRoot $connectorArchiveName
    $connectorChecksums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$connectorNodeVersion/SHASUMS256.txt").Content
    $connectorExpectedHash = (($connectorChecksums -split "`n" | Where-Object { $_ -match "\s+$([regex]::Escape($connectorArchiveName))\s*$" }) -split '\s+')[0]
    if ($connectorExpectedHash -notmatch '^[a-f0-9]{64}$') { throw '공식 런타임 체크섬을 확인하지 못했습니다 / Runtime checksum unavailable' }
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$connectorNodeVersion/$connectorArchiveName" -OutFile $connectorArchive
    if ((Get-FileHash -LiteralPath $connectorArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $connectorExpectedHash) { throw '런타임 파일 검증 실패 / Runtime checksum mismatch' }
    Expand-Archive -LiteralPath $connectorArchive -DestinationPath $connectorInstallRoot -Force
    Remove-Item -LiteralPath $connectorArchive
}
$connectorCodexRoot = Join-Path $connectorInstallRoot 'tools'
$connectorCodex = Join-Path $connectorCodexRoot 'node_modules\@openai\codex\bin\codex.js'
if (-not (Test-Path -LiteralPath $connectorCodex)) {
    $env:PATH = "$connectorRuntimeRoot;$env:PATH"
    & (Join-Path $connectorRuntimeRoot 'npm.cmd') install --prefix $connectorCodexRoot --no-audit --no-fund '@openai/codex@0.154.0'
    if ($LASTEXITCODE -ne 0) { throw '공식 Codex 설치 실패 / Codex installation failed' }
}
# Codex's npm entry point is a JS launcher. Resolve the official Windows binary
# from the package's optional platform dependency instead of invoking a shell.
$connectorPlatform = if ($connectorArchitecture -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
$connectorBinary = Get-ChildItem -LiteralPath (Join-Path $connectorCodexRoot 'node_modules\@openai') -Recurse -Filter codex.exe |
    Where-Object { $_.FullName.Contains($connectorPlatform) } | Select-Object -First 1 -ExpandProperty FullName
if (-not $connectorBinary) { throw '공식 Codex 실행 파일을 찾지 못했습니다 / Codex binary unavailable' }
$connectorBundle = Join-Path $PSScriptRoot 'nk-image-connector.cjs'
$connectorBundleHash = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'nk-image-connector.sha256') -Encoding utf8).Trim()
if ((Get-FileHash -LiteralPath $connectorBundle -Algorithm SHA256).Hash.ToLowerInvariant() -ne $connectorBundleHash) { throw '연결 프로그램 검증 실패 / Connector checksum mismatch' }
Copy-Item -LiteralPath $connectorBundle -Destination (Join-Path $connectorInstallRoot 'nk-image-connector.cjs') -Force
$env:NK_CODEX_BINARY = $connectorBinary
$connectorArguments = @((Join-Path $connectorInstallRoot 'nk-image-connector.cjs'))
if ($args -contains '--new-profile') { $connectorArguments += '--new-profile' }
& $connectorNode @connectorArguments
