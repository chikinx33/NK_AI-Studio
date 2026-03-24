@echo off
rem Auto-push after every successful commit (Windows)
npm test
if errorlevel 1 exit /b 1
git push origin HEAD:main
exit /b 0
