@echo off
setlocal

:: Define source settings.json file location (from repo)
set SOURCE=settings.json

:: Define target destination (VS Code User Settings folder)
set TARGET=%APPDATA%\Code\User\settings.json
set BACKUP=%APPDATA%\Code\User\settings.json.bak

:: Ensure the target directory exists
if not exist "%APPDATA%\Code\User" (
    echo Creating VS Code settings directory...
    mkdir "%APPDATA%\Code\User"
)

:: If settings.json already exists, rename it to settings.json.bak
if exist "%TARGET%" (
    echo Backing up existing settings.json to settings.json.bak...
    move /Y "%TARGET%" "%BACKUP%"
)

:: Copy the new settings file
echo Copying settings.json to %TARGET%...
copy /Y "%SOURCE%" "%TARGET%"

:: Verify success
if %errorlevel% == 0 (
    echo Settings copied successfully.
) else (
    echo Failed to copy settings.
)

endlocal
pause
