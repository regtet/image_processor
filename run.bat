@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 图片批量处理器
set "EXIT_CODE=0"

:: ================= 主菜单 =================
echo ========================================
echo   1) 输入/粘贴 Google Drive 链接，自动用浏览器打开下载压缩包
echo   2) 直接对本地图片文件夹进行转换 + 压缩
echo ========================================
echo.
set "MODE=1"
set /p MODE="请选择模式 (直接回车默认 1): "
if "%MODE%"=="" set "MODE=1"
if "%MODE%"=="2" goto from_local

:: ========= 模式 1：链接 -> 下载 -> 解压 -> 继续流程 =========
:from_urls
cd /d "%~dp0"
cls
echo ======================================================
echo           批量链接自动拆分 + 打开工具
echo ======================================================
echo.
echo 请多次粘贴链接，每次一部分，回车确认；
echo 全部粘完后直接回车留空结束输入：
echo.

set "RAW_ALL="

:input_links_loop
set "line="
set /p "line=> "
if "%line%"=="" goto input_links_done

:: 累加到总字符串中，用空格隔开
if defined RAW_ALL (
    set "RAW_ALL=%RAW_ALL% %line%"
) else (
    set "RAW_ALL=%line%"
)
goto input_links_loop

:input_links_done
set "raw_input=%RAW_ALL%"

if "%raw_input%"=="" (
    echo.
    echo [错误] 输入为空！
    pause
    goto from_urls
)

echo.
set "DOWNLOAD_DIR=%USERPROFILE%\Downloads"
set /p "DOWNLOAD_DIR=压缩包下载目录(直接回车默认 %DOWNLOAD_DIR%): "
if "%DOWNLOAD_DIR%"=="" set "DOWNLOAD_DIR=%USERPROFILE%\Downloads"

set "EXTRACT_DIR=%DOWNLOAD_DIR%\gdrive_extracted"
set /p "EXTRACT_DIR=解压目标目录(直接回车默认 %EXTRACT_DIR%): "
if "%EXTRACT_DIR%"=="" set "EXTRACT_DIR=%DOWNLOAD_DIR%\gdrive_extracted"

if not exist "%EXTRACT_DIR%" mkdir "%EXTRACT_DIR%"

echo.
echo 正在解析并在默认浏览器中打开链接...
echo ------------------------------------------------------

::: 1) 下载前统计当前 ZIP 数量
for /f %%C in ('dir "%DOWNLOAD_DIR%" /a-d /b ^| findstr /i "\.zip$" ^| find /c /v ""') do set FILE_COUNT_BEFORE=%%C
echo 下载前 ZIP 数量: %FILE_COUNT_BEFORE%

:: 2) 统计链接数量并按 3 秒节流打开
powershell -NoProfile -Command ^
    "$inputStr = '%raw_input%'; " ^
    "$urls = $inputStr -split '(?=https?://)'; " ^
    "$i = 0; " ^
    "foreach ($url in $urls) { " ^
    "  $u = $url.Trim(); " ^
    "  if ($u -like 'http*') { " ^
    "    $i++; " ^
    "    Write-Host \"[$i] 正在打开: $u\"; " ^
    "    Start-Process $u; " ^
    "    Start-Sleep -Seconds 3; " ^
    "  } " ^
    "}; " ^
    "Write-Output $i" > "%~dp0urlcount.tmp"

if errorlevel 1 (
    echo.
    echo [ERROR] 打开链接过程中 PowerShell 执行出错，程序即将退出。
    set "EXIT_CODE=1"
    goto end_all
)

set "URL_COUNT=0"
if exist "%~dp0urlcount.tmp" (
    for /f "usebackq delims=" %%C in ("%~dp0urlcount.tmp") do set "URL_COUNT=%%C"
    del "%~dp0urlcount.tmp" >nul 2>&1
)

if "%URL_COUNT%"=="" set URL_COUNT=0
set /a TARGET_COUNT=%FILE_COUNT_BEFORE% + %URL_COUNT%

echo 需要下载: %URL_COUNT% 个文件
echo 下载完成目标: %TARGET_COUNT% 个文件

echo ------------------------------------------------------
echo [INFO] 已让浏览器打开所有识别到的链接，自动开始检测下载进度...

call :wait_download "%DOWNLOAD_DIR%" %TARGET_COUNT%
call :unzip_all "%DOWNLOAD_DIR%" "%EXTRACT_DIR%"

:: 把解压后的总目录作为待处理文件夹，进入后续转换 + 压缩流程
set "FOLDER_PATH=%EXTRACT_DIR%"
goto image_flow


:: ========= 模式 2：直接本地文件夹 =========
:from_local
cd /d "%~dp0"
set "FOLDER_PATH="

:: 判断是否拖拽文件夹到 bat
if "%~1"=="" (
    echo [INFO] Usage: Drag a folder onto this bat file
    echo        Or enter folder path below:
    echo.
    set /p FOLDER_PATH="Enter image folder path: "
) else (
    set "FOLDER_PATH=%~1"
)

if "%FOLDER_PATH%"=="" (
    echo [ERROR] 未指定文件夹路径，程序结束。
    set "EXIT_CODE=1"
    goto end_all
)

goto image_flow


:: ========= 公共：Node 转换 + 压缩流程 =========
:image_flow
cd /d "%~dp0"

:: 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found
    echo Download from: https://nodejs.org/
    set "EXIT_CODE=1"
    goto end_all
)

:: 如有需要安装依赖
if not exist "node_modules" (
    echo [INFO] First run, installing dependencies...
    call npm install
    
    echo [INFO] Installing browser driver...
    call npx playwright install chromium
    
    echo [OK] Setup complete!
    echo.
)

echo.
echo [INFO] Processing folder: %FOLDER_PATH%
echo.

:loop
set "IMG_SHOW_BROWSER=n"
set "IMG_PARALLEL=5"
set "IMG_NON_INTERACTIVE=1"
node image_processor.js "%FOLDER_PATH%"

echo.
echo ========================================
echo   流程完成！按回车键重新开始流程
echo   输入 q 后回车可退出
echo ========================================
set /p RESTART=""
if /i "%RESTART%"=="q" (
    set "EXIT_CODE=0"
    goto end_all
)
goto loop


::: ========= 工具：等待下载完成 =========
:wait_download
set "DL_DIR=%~1"
set "TARGET_COUNT=%~2"
set "LOOP_COUNT=0"

:wait_loop
set /a LOOP_COUNT+=1

for /f %%C in ('dir "%DL_DIR%" /a-d /b ^| findstr /i "\.zip$" ^| find /c /v ""') do set FILE_COUNT_NOW=%%C

echo 当前 ZIP 数: !FILE_COUNT_NOW! / 目标: !TARGET_COUNT!  (第 !LOOP_COUNT! 次检测)

if !FILE_COUNT_NOW! GEQ !TARGET_COUNT! (
    echo 下载完成，等待 10 秒确保所有 ZIP 写入完毕...
    timeout /t 10 /nobreak >nul
    goto :eof
)

timeout /t 5 /nobreak >nul
if !LOOP_COUNT! LSS 720 goto wait_loop

echo [WARN] 等待时间过长，可能仍有未完成的下载，请自行确认下载目录。
goto :eof


:: ========= 工具：解压所有 zip =========
:unzip_all
set "DL_DIR=%~1"
set "OUT_DIR=%~2"

echo.
echo [INFO] 正在解压 "%DL_DIR%" 中的所有 zip 到 "%OUT_DIR%" ...
powershell -NoProfile -Command ^
  "$zips = Get-ChildItem -Path '%DL_DIR%' -Filter '*.zip'; " ^
  "foreach ($z in $zips) { " ^
  "  $name = [IO.Path]::GetFileNameWithoutExtension($z.Name); " ^
  "  $dest = Join-Path '%OUT_DIR%' $name; " ^
  "  if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest | Out-Null } " ^
  "  Write-Host ('解压: ' + $z.FullName + ' -> ' + $dest); " ^
  "  Expand-Archive -Path $z.FullName -DestinationPath $dest -Force " ^
  "}"

echo [INFO] 解压完成。
goto :eof

:end_all
if not defined EXIT_CODE set "EXIT_CODE=0"
echo.
echo ========================================
echo   所有流程已结束。
echo   按任意键关闭窗口...
echo ========================================
pause
exit /b %EXIT_CODE%