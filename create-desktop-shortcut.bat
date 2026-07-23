@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1"
echo.
echo  Double-click "Web Mirror" on the Desktop to launch.
pause
