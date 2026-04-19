@echo off
taskkill /f /im "Flow.Launcher.exe" 2>nul

:wait_for_exit
tasklist /fi "imagename eq Flow.Launcher.exe" | find /i "Flow.Launcher.exe" >nul
if not errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_for_exit
)

timeout /t 2 /nobreak >nul

:: Reset PATH from registry (system + user)
for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USR_PATH=%%B"
set "PATH=%SYS_PATH%;%USR_PATH%"

call env.bat
start "" "Flow.Launcher.exe"