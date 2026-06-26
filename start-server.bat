@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo Missing .env file.
  echo Copy .env.example to .env and fill in your Supabase values first.
  pause
  exit /b 1
)

where python >nul 2>nul
if %errorlevel%==0 (
  python local_server.py
) else (
  py -3 local_server.py
)

pause
