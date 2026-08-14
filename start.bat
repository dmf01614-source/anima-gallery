@echo off
cd /d "%~dp0"
echo [1/2] Checking updates...
python update-check.py --auto
echo.
echo [2/2] Starting Anima Gallery...
python server.py
pause
