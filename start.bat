@echo off
title Hexlands server
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org , install it, then run this again.
  pause
  exit /b 1
)
cd /d "%~dp0"
node server\server.js
pause
