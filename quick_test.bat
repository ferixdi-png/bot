@echo off
cd /d "%~dp0"
echo ========================================
echo Quick Bot Test
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH!
    pause
    exit /b 1
)

REM Activate virtual environment if it exists
if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
)

REM Run test script
echo Running bot command tests...
echo.
python test_bot.py

if errorlevel 1 (
    echo.
    echo ========================================
    echo Tests failed!
    echo ========================================
    pause
    exit /b 1
) else (
    echo.
    echo ========================================
    echo All tests passed!
    echo ========================================
    echo.
    echo To start the bot, run: start_bot.bat
    echo.
    pause
)

