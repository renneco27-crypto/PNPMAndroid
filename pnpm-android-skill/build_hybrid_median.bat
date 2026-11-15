@echo off
setlocal enabledelayedexpansion
title Building StudyUp Hybrid Android App (Median.co Specs)

echo ========================================================
echo   StudyUp Hybrid Android Build Pipeline (Median.co Specs)
echo ========================================================
echo.

REM 1. Pre-flight Environment Checks
echo [1/5] Checking environment requirements...
where pnpm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] pnpm is not installed or not in PATH.
    pause
    exit /b 1
)

where adb >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [WARNING] adb is not found in PATH. Make sure Android SDK platform-tools are installed.
)

REM 2. Clean Stale Builds and Ghost Chunks
echo [2/5] Purging stale static assets to prevent chunk caching conflicts...
if exist "android\app\src\main\assets\public\_next" (
    rd /s /q "android\app\src\main\assets\public\_next"
)

REM 3. Compile Web Application
echo [3/5] Compiling Next.js production bundle with Serwist...
call pnpm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Next.js compilation failed.
    pause
    exit /b %ERRORLEVEL%
)

REM 4. Synchronize Android Assets
echo [4/5] Synchronizing web assets with AAPT safeguards...
node scripts/sync-android-assets.js
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Asset synchronization failed.
    pause
    exit /b %ERRORLEVEL%
)

REM 5. Assemble Android Debug APK
echo [5/5] Compiling Android APK with Gradle (assembleDebug)...
cd android
call .\gradlew.bat assembleDebug
set GRADLE_ERR=%ERRORLEVEL%
cd ..
if %GRADLE_ERR% neq 0 (
    echo [ERROR] Gradle compilation failed with exit code %GRADLE_ERR%.
    pause
    exit /b %GRADLE_ERR%
)

REM 6. Fast Streaming Install to Connected ADB Device
set APK_PATH=android\app\build\outputs\apk\debug\app-debug.apk
if exist "%APK_PATH%" (
    echo.
    echo ========================================================
    echo   APK COMPILED SUCCESSFULLY: %APK_PATH%
    echo ========================================================
    echo.
    echo Checking for connected Android devices via ADB...
    adb devices
    echo Streaming APK install to device...
    adb push "%APK_PATH%" /data/local/tmp/app.apk
    adb shell pm install -r /data/local/tmp/app.apk
    if %ERRORLEVEL% equ 0 (
        echo Force stopping and launching com.studyup.app...
        adb shell am force-stop com.studyup.app
        adb shell am start -n com.studyup.app/.MainActivity
        echo.
        echo ========================================================
        echo   BUILD AND DEPLOY SUCCESSFUL!
        echo ========================================================
    ) else (
        echo [WARNING] ADB install failed or no device connected.
    )
) else (
    echo [ERROR] Expected APK not found at %APK_PATH%
    pause
    exit /b 1
)

echo.
echo Done!
pause
