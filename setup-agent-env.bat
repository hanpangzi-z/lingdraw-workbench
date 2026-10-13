@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>&1
if errorlevel 1 (
    echo Error: Python launcher was not found. Install Python 3.11 or newer first.
    exit /b 1
)

if not exist ".venv-agent\Scripts\python.exe" (
    echo Creating .venv-agent...
    py -3 -m venv .venv-agent
    if errorlevel 1 exit /b 1
)

echo Installing locked dependencies...
".venv-agent\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 exit /b 1
".venv-agent\Scripts\python.exe" -m pip install -r requirements.lock
if errorlevel 1 exit /b 1

".venv-agent\Scripts\python.exe" -c "import fastapi, sqlalchemy, asyncpg, alembic, temporalio, pptx; print('Design Agent environment is ready.')"
exit /b %ERRORLEVEL%
