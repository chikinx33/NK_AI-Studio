@echo off
node --test prototype/tests/*.test.mjs
if errorlevel 1 exit /b 1
exit /b 0
