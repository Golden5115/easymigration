@echo off
title Speedotrack Bulk Provisioner
cd /d "%~dp0"
echo ========================================================
echo   Speedotrack Bulk Provisioner - Local Server
echo ========================================================
echo.
echo Starting local service on http://localhost:3000 ...
start http://localhost:3000
node server.js
pause
