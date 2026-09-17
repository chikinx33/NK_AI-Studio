@echo off
chcp 65001 >nul
rem Let Windows PowerShell load its own modules when launched from PowerShell 7.
rem Downloaded zips carry Mark-of-the-Web, so RemoteSigned/AllSigned policies block the unsigned installer; bypass for this process only.
set "PSModulePath="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-NKStudio-Images.ps1" %*
if errorlevel 1 (
  echo NKStudio connector could not start. Please share the error message.
  pause
)
