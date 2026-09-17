@echo off
chcp 65001 >nul
powershell.exe -NoProfile -File "%~dp0Install-NKStudio-Images.ps1" %*
if errorlevel 1 (
  echo NKStudio connector could not start. Please share the error message.
  pause
)
