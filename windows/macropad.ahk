#Requires AutoHotkey v2.0

F22::
{
    Run 'wt.exe -p PowerShell -d C:\\dev\\'
}

F23::
{
    Run 'wt.exe -p "Command Prompt" -d C:\\dev\\'
}

; F24::
; {
; 	Run 'cmder.exe /c C:\\dev\\'
; }

vkC1::
{
    Run 'powershell -NoProfile -Command "Start-Process code -ArgumentList C:\\dev\\"'
}