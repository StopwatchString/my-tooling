@echo off
setlocal

:: Define source settings.json file location
set SOURCE=settings.json

:: Define target destination (VS Code User Settings folder)
set TARGET=%APPDATA%\Code\User\settings.json

:: Ensure the target directory exists
if not exist "%APPDATA%\Code\User" (
    echo Creating VS Code settings directory...
    mkdir "%APPDATA%\Code\User"
)

:: Copy the settings file
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