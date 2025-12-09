@echo off
chcp 65001 >nul
echo ========================================
echo   Остановка KIE Telegram Bot
echo ========================================
echo.

REM Поиск и остановка процесса бота
for /f "tokens=2" %%a in ('tasklist /FI "WINDOWTITLE eq KIE Telegram Bot*" /FO LIST ^| findstr /C:"PID:"') do (
    echo Остановка процесса с PID: %%a
    taskkill /PID %%a /F >nul 2>&1
)

REM Альтернативный способ - остановка всех python процессов с run_bot.py
wmic process where "commandline like '%%run_bot.py%%'" delete >nul 2>&1

echo.
echo Бот остановлен (если был запущен)
echo.
pause

