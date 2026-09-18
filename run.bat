@echo off
title Speedotrack Provisioner & Cutover Switchboard
cd /d "%~dp0"
echo ========================================================
echo Starting Speedotrack Provisioner & Cutover Switchboard
echo Directory: %cd%
echo URL: http://localhost:3000
echo ========================================================
echo.

:: Free port 3000 if an existing background instance was open
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)

node server.js
pause
