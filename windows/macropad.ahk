#Requires AutoHotkey v2.0

F22::
{
    KeyWait(A_ThisHotkey)
    targetPath := GetTargetPath()
    Run('wt.exe -p "Powershell" -d ' targetPath)
}

F23::
{
    KeyWait(A_ThisHotkey)
    targetPath := GetTargetPath()
    Run('wt.exe -p "Command Prompt" -d ' targetPath)
}

; F24::
; {
; 	Run 'cmder.exe /c C:\\dev\\'
; }

vkC1::
{
    KeyWait(A_ThisHotkey)
    targetPath := GetTargetPath()
    Run ('powershell -NoProfile -Command "Start-Process code -ArgumentList ' targetPath '"')
}

GetTargetPath() {
    ; Default to C:\dev\
    targetPath := "C:\\dev\\"

    ; Try to intelligently determine path from active window
    if WinActive("ahk_class CabinetWClass") || WinActive("ahk_class ExplorerWClass") {
        shell := ComObject("Shell.Application")
        for window in shell.Windows {
            if window.hwnd = WinActive("A") { ; Get the active Explorer window
                targetPath := window.Document.Folder.Self.Path
            }
        }
    }

    return targetPath
}