@echo off
title Wuyan Audit Assistant - Launcher
setlocal enabledelayedexpansion

echo.
echo  ============================================================
echo    Wuyan Team - Fraud Audit Investigation Assistant
echo    AI Work Assistant for Financial Fraud Audit
echo  ============================================================
echo.

cd /d "%~dp0"

REM ---------- Check Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo  [!] Node.js not found.
  echo.
  echo      The backend security proxy requires Node.js (v16 or above).
  echo      Download from https://nodejs.org and run this script again.
  echo.
  echo      Tip: you can also double-click index.html
  echo           to use the demo-data offline mode.
  echo.
  pause
  start "" "index.html"
  exit /b 0
)

for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js version: !NODE_VER!

REM ---------- Check dependencies ----------
if not exist "node_modules\mysql2" (
  echo.
  echo  [1/3] First run: installing dependencies (mysql2)...
  call npm.cmd install --omit=dev
  if errorlevel 1 (
    echo.
    echo  [!] Dependency install failed.
    echo      In offline mode, double-click index.html for demo data.
    echo.
    pause
    start "" "index.html"
  exit /b 0
  )
) else (
  echo  [1/3] Dependencies ready
)

REM ---------- Start backend proxy ----------
echo  [2/3] Starting backend proxy (http://127.0.0.1:3001)...
start "wuyan-proxy" cmd /c "node server.js & echo. & echo Server stopped. Press any key to close. & pause >nul"

echo         Waiting for service...
set /a WAIT_COUNT=0
:WAIT_LOOP
timeout /t 1 >nul
set /a WAIT_COUNT+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  if !WAIT_COUNT! LSS 12 goto WAIT_LOOP
  echo  [!] Service start timeout, still trying to open frontend.
) else (
  echo  [OK] Backend service ready
)

REM ---------- Open frontend ----------
echo  [3/3] Opening frontend...
start "" "index.html"

echo.
echo  ============================================================
echo    Launch complete
echo  ============================================================
echo.
echo    Frontend : index.html
echo    Backend  : http://127.0.0.1:3001/api
echo    Health   : http://127.0.0.1:3001/api/health
echo.
echo    Tips:
echo      - Top bar toggles "Demo data / Connect DB" modes
echo      - Offline demo mode: double-click index.html
echo      - Close the backend window to stop the service
echo.
echo  ============================================================
echo.
pause
endlocal
