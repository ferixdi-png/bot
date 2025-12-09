@echo off
cd /d "%~dp0"
echo ========================================
echo Starting KIE Telegram Bot
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH!
    echo Please install Python 3.8+ and try again.
    pause
    exit /b 1
)

REM Create virtual environment if it doesn't exist
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment!
        pause
        exit /b 1
    )
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat
if errorlevel 1 (
    echo ERROR: Failed to activate virtual environment!
    pause
    exit /b 1
)

REM Install dependencies
echo Installing dependencies...
pip install -q -r requirements.txt
if errorlevel 1 (
    echo WARNING: Some dependencies may not have installed correctly.
    echo Continuing anyway...
)

echo.
echo ========================================
echo Starting bot...
echo ========================================
echo.

REM Run the bot
python run_bot.py

REM Keep window open if there's an error
if errorlevel 1 (
    echo.
    echo ========================================
    echo Bot stopped with an error!
    echo ========================================
    pause
)
