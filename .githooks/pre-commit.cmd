@echo off
rem Ensure tests pass and version is bumped before commit (Windows)
npm test
if errorlevel 1 exit /b 1
node scripts\precommit-bump.js
if errorlevel 1 exit /b 1
exit /b 0
