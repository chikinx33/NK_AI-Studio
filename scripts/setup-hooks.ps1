Set-Location (Split-Path -Parent $PSScriptRoot)
git config core.hooksPath .githooks
Write-Output "Configured core.hooksPath to .githooks"
