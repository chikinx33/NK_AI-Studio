Set-Location (Split-Path -Parent $PSScriptRoot)
git config core.hooksPath .githooks
Write-Output "Configured core.hooksPath to .githooks"
Write-Output "Hooks installed: pre-commit (test+auto-bump), pre-push (test guard), post-commit (auto-push)"
