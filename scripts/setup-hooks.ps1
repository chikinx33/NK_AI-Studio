Set-Location (Split-Path -Parent $PSScriptRoot)
git config core.hooksPath .githooks
Write-Output "Configured core.hooksPath to .githooks"
Write-Output "Hooks installed: pre-push, post-commit (auto-push after commit)"
