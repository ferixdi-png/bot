@echo off
chcp 65001 >nul

REM ВАЖНО: Переходим в директорию, где находится этот скрипт
cd /d "%~dp0"

REM Проверяем, что мы в правильной директории
if not exist "run_bot.py" (
    echo [ОШИБКА] Файл run_bot.py не найден в директории скрипта!
    echo Текущая директория: %CD%
    echo Директория скрипта: %~dp0
    pause
    exit /b 1
)

echo ========================================
echo   Запуск KIE Telegram Bot
echo ========================================
echo.
echo Директория: %CD%
echo.

REM Проверка Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Python не установлен!
    pause
    exit /b 1
)

echo Запуск бота...
echo Нажмите Ctrl+C для остановки
echo.

REM Запуск бота с явным указанием пути
python "%~dp0run_bot.py"

pause

