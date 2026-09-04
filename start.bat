@echo off
chcp 65001 >nul
title JJHealth Sync Server
cd /d "%~dp0server"
node server.js
echo.
echo Server stopped. Press any key to close.
pause >nul
