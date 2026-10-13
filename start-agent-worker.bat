@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\mysql\windows.ps1" -Action worker
exit /b %ERRORLEVEL%
