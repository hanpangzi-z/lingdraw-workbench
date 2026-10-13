@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\mysql\windows.ps1" -Action stop
exit /b %ERRORLEVEL%
