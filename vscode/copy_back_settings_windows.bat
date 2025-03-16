@echo off
setlocal

:: Define source (VS Code User settings file)
set SOURCE=%APPDATA%\Code\User\settings.json

:: Define target (your repo location)
set TARGET=settings.json

:: Ensure the source file exists
if not exist "%SOURCE%" (
    echo No settings.json found in VS Code User folder.
    pause
    exit /b
)

:: Copy the settings file
echo Copying settings.json from %SOURCE% to %TARGET%...
copy /Y "%SOURCE%" "%TARGET%"

:: Verify success
if %errorlevel% == 0 (
    echo Settings backed up successfully.
) else (
    echo Failed to back up settings.
)

endlocal
pause
