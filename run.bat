@echo off
title Image Batch Processor
echo ========================================
echo   Image Batch Processor
echo ========================================
echo.

cd /d "%~dp0"

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo [INFO] First run, installing dependencies...
    call npm install
    
    echo [INFO] Installing browser driver...
    call npx playwright install chromium
    
    echo [OK] Setup complete!
    echo.
)

:: Check if folder was dragged onto this bat file
if "%~1"=="" (
    echo [INFO] Usage: Drag a folder onto this bat file
    echo        Or enter folder path below:
    echo.
    set /p FOLDER_PATH="Enter image folder path: "
) else (
    set "FOLDER_PATH=%~1"
)

echo.
echo [INFO] Processing folder: %FOLDER_PATH%
echo.

:: Run main program with folder path as argument
node image_processor.js "%FOLDER_PATH%"

echo.
echo ========================================
echo   Done! Press any key to exit...
echo ========================================
pause >nul
