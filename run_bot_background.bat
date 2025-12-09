@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   Запуск KIE Telegram Bot (в фоне)
echo ========================================
echo.

REM Проверка Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Python не установлен!
    pause
    exit /b 1
)

REM Проверка токена через Python (более надежно)
python -c "import os; from pathlib import Path; env_file = Path('.env'); exit(0 if env_file.exists() else 1)" >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Файл .env не найден!
    pause
    exit /b 1
)

REM Установка зависимостей (если нужно)
python -c "import telegram" >nul 2>&1
if errorlevel 1 (
    echo Установка зависимостей...
    pip install python-telegram-bot python-dotenv aiohttp
)

echo Запуск бота в фоновом режиме...
echo Логи сохраняются в bot.log
echo.

REM Запуск бота в фоне с логированием
start "KIE Telegram Bot" /min cmd /c "python run_bot.py > bot.log 2>&1"

timeout /t 2 >nul
echo Бот запущен!
echo.
echo Для остановки бота:
echo 1. Откройте Диспетчер задач
echo 2. Найдите процесс python.exe
echo 3. Завершите процесс
echo.
echo Или используйте: taskkill /FI "WINDOWTITLE eq KIE Telegram Bot*"
echo.
pause

