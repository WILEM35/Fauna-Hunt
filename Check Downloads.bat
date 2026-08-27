@echo off
title Fauna Hunt - download count
cd /d "%~dp0"
where py >nul 2>nul && (py check_downloads.py & goto done)
where python >nul 2>nul && (python check_downloads.py & goto done)
echo   Python is not installed - use this link in your browser instead:
echo   https://api.github.com/repos/WILEM35/Fauna-Hunt/releases
:done
echo.
pause
