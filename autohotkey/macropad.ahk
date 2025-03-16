;------------------------------------------------------------------------------
; @file    macropad.ahk
; @author  Mason Speck (Github: StopwatchString)
; @brief   Autohotkey script for Macropad functionality
; @details This file is separated into 3 parts:
;          1) Hotkey assignment: These functions should implement only
;             procedure calling, so that hotkey reassignment is easy.
;          2) Procedures: These are the actual functionality expected out of
;             the hotkey. These are self-contained behaviors that are easily
;             moved between hotkeys.
;          3) Helper functions: Meta functions that are callable by any
;             procedure. Hotkey assignment functions should never have a
;             reason to call these.
;------------------------------------------------------------------------------

#Requires AutoHotkey v2.0

;==============================================================================
; HOTKEY ASSIGNMENT
;==============================================================================

;------------------------------------------------------------------------------
; F13
;------------------------------------------------------------------------------
F13::
{
    ; Key handling
    KeyWait(A_ThisHotkey) ; Only execute when key is released to stop spam

    ; Procedure
    ToolTip("Reloading script...")
    Sleep(300)
    Reload
}

;------------------------------------------------------------------------------
; F19
;------------------------------------------------------------------------------
F19::
{
    ; Procedure
    openWindowsTerminalPowershellAdministrator()
}

;------------------------------------------------------------------------------
; F20
;------------------------------------------------------------------------------
F20::
{
    ; Procedure
    openWindowsTerminalCommandPromptAdministrator()
}

;------------------------------------------------------------------------------
; F21
;------------------------------------------------------------------------------
F21::
{
    ; Procedure
    openCmakeGui()
}

;------------------------------------------------------------------------------
; F22
;------------------------------------------------------------------------------
F22::
{
    ; Procedure
    openWindowsTerminalPowershell()
}

;------------------------------------------------------------------------------
; F23
;------------------------------------------------------------------------------
F23::
{
    ; Procedure
    openWindowsTerminalCommandPrompt()
}

;------------------------------------------------------------------------------
; F24
;------------------------------------------------------------------------------
F24::
{
    ; Procedure
}

;------------------------------------------------------------------------------
; vkC1
;------------------------------------------------------------------------------
vkC1::
{
    ; Procedure
    openVsCodeFolderMode()
}

;==============================================================================
; PROCEDURES
;==============================================================================

;------------------------------------------------------------------------------
; @procedure Open Windows Terminal Powershell
; @function  openWindowsTerminalPowershell()
;------------------------------------------------------------------------------
openWindowsTerminalPowershell()
{
    targetPath := directorySelectWithTooltipLoop("Powershell: ")
    targetPath := addQuotesToString(targetPath)

    Run('wt.exe -p "Powershell" -d ' targetPath)
}

;------------------------------------------------------------------------------
; @procedure Open Windows Terminal Powershell (Administrator)
; @function  openWindowsTerminalPowershellAdministrator()
;------------------------------------------------------------------------------
openWindowsTerminalPowershellAdministrator()
{
    targetPath := directorySelectWithTooltipLoop("Powershell (Admin): ")
    targetPath := addQuotesToString(targetPath)

    command := 'wt.exe -p "Powershell" -d ' targetPath
    Run("*RunAs " . command)
}

;------------------------------------------------------------------------------
; @procedure Open Windows Terminal Command Prompt
; @function  openWindowsTerminalCommandPrompt()
;------------------------------------------------------------------------------
openWindowsTerminalCommandPrompt()
{
    targetPath := directorySelectWithTooltipLoop("Command Prompt: ")
    targetPath := addQuotesToString(targetPath)

    Run('wt.exe -p "Command Prompt" -d ' targetPath)
}

;------------------------------------------------------------------------------
; @procedure Open Windows Terminal Command Prompt (Administrator)
; @function  openWindowsTerminalCommandPrompt()
;------------------------------------------------------------------------------
openWindowsTerminalCommandPromptAdministrator()
{
    targetPath := directorySelectWithTooltipLoop("Command Prompt (Admin): ")
    targetPath := addQuotesToString(targetPath)

    command := 'wt.exe -p "Command Prompt" -d ' targetPath
    Run("*RunAs " . command)
}

;------------------------------------------------------------------------------
; @procedure Open CMAKE Gui with local CMakeLists.txt
; @function  openCmakeGui()
; @details   Attempts to find a CMakeLists.txt 
;------------------------------------------------------------------------------
openCmakeGui()
{
    targetPath := directorySelectWithTooltipLoop("CMakeLists.txt Directory: ")

    if isFileInDirectory("CMakeLists.txt", targetPath) {
        buildPath := targetPath . "\build"
        Run('powershell cmake-gui -S ' . targetPath . ' -B ' . buildPath)
    } else {
        MsgBox("No CMakeLists.txt detected.")
    }
}

;------------------------------------------------------------------------------
; @procedure Search for a local premake5.lua and execute it with premake.
;            Includes confirmation dialogue that names the path.
; @function  findAndRunPremake()
; @details   Attempts to find a premake5.lua and run premake against it.
;            This procedure only works if an active explorer folder can be
;            found. This explorer folder is recursively searched for a
;            premake file. If found, then a confirmation dialogue will pop
;            up asking if it's the correct premake file. If confirmed,
;            premake will be ran. Otherwise nothing happens.
;------------------------------------------------------------------------------
findAndRunPremake()
{
    ; TODO
}

;------------------------------------------------------------------------------
; @procedure Open VSCode in Folder Mode
; @function  openVsCodeFolderMode()
; @details   Opens VSCode in folder mode, with two possible scenarios:
;            1) If an explorer-type window is active with a folder path, then
;               open VSCode in that folder.
;            2) Otherwise, default to C:\dev\
;------------------------------------------------------------------------------
openVsCodeFolderMode()
{
    targetPath := directorySelectWithTooltipLoop("VS Code: ")
    targetPath := addQuotesToString(targetPath)

    Run('powershell -NoProfile -Command `"Start-Process code -ArgumentList `'\' targetPath '\`"`'' )
}

;==============================================================================
; HELPER FUNCTIONS
;==============================================================================

;------------------------------------------------------------------------------
; @function detectTargetDirectory()
; @details  Attempt to intelligently pick a target directory based on state
;           Autohotkey can read, such as current active window. Defaults to
;           C:\dev\ if no target is found.
; @return   Target path as a string
;------------------------------------------------------------------------------
detectTargetDirectory()
{
    targetPath := getDefaultDirectory()

    ; Try to intelligently determine path from active window
    explorerPath := getExplorerDirectory()
    if explorerPath != "" {
        targetPath := explorerPath
    }

    return targetPath
}

;------------------------------------------------------------------------------
; @function directorySelectWithTooltipLoop()
; @details  While the current hotkey remains held, periodically grab the target
;           target directory from detectTargetDirectory() and display it in
;           the cursor tooltip. When the key is released, return the current
;           target directory.
; @param    stringPrefix: Prefix for tooltip
; @return   Final selected target directory as a string
;------------------------------------------------------------------------------
directorySelectWithTooltipLoop(stringPrefix)
{
    static KEY_STATE_CHECK_SLEEP_TIME_MS := 10
    targetDirectory := ""
    while (GetKeyState(A_ThisHotkey)) {
        targetDirectory := detectTargetDirectory()
        ToolTip(stringPrefix . targetDirectory)
        Sleep(KEY_STATE_CHECK_SLEEP_TIME_MS)
    }
    ToolTip("")
    return targetDirectory
}

;------------------------------------------------------------------------------
; @function getExplorerDirectory()
; @details  Checks if a CabinetWClass or ExplorerWClass window is active, and
;           if so will attempt to retreive the associated path.
; @return   Explorer path as string if detected, otherwise empty string.
;------------------------------------------------------------------------------
getExplorerDirectory()
{
    explorerPath := ""
    if WinActive("ahk_class CabinetWClass") || WinActive("ahk_class ExplorerWClass") {
        shell := ComObject("Shell.Application")
        window := GetActiveExplorerTab()
        explorerPath := window.Document.Folder.Self.Path

        ; Old version
        ;for window in shell.Windows {
        ;    if window.hwnd == WinActive("A") { ; Get the active Explorer window
        ;        explorerPath := window.Document.Folder.Self.Path
        ;        break
        ;    }
        ;}
    }
    return explorerPath
}

;------------------------------------------------------------------------------
; @function GetActiveExplorerTab
; @details  Get the WebBrowser object of the active Explorer tab for the given
;           window, or the window itself if it doesn't have tabs. Supports IE 
;           and File Explorer.
; @return   Window handle
; @source   https://www.autohotkey.com/boards/viewtopic.php?f=83&t=109907&sid=22494fb01b26930ecbba2494f0f5d576
;------------------------------------------------------------------------------
GetActiveExplorerTab(hwnd := WinExist("A")) {
    activeTab := 0
    try activeTab := ControlGetHwnd("ShellTabWindowClass1", hwnd) ; File Explorer (Windows 11)
    catch
    try activeTab := ControlGetHwnd("TabWindowClass1", hwnd) ; IE
    for w in ComObject("Shell.Application").Windows {
        if w.hwnd != hwnd
            continue
        if activeTab { ; The window has tabs, so make sure this is the right one.
            static IID_IShellBrowser := "{000214E2-0000-0000-C000-000000000046}"
            shellBrowser := ComObjQuery(w, IID_IShellBrowser, IID_IShellBrowser)
            ComCall(3, shellBrowser, "uint*", &thisTab:=0)
            if thisTab != activeTab
                continue
        }
        return w
    }
}

;------------------------------------------------------------------------------
; @function isFileInDirectory()
; @details  Checks if a CabinetWClass or ExplorerWClass window is active, and
;           if so will attempt to retreive the associated path.
; @return   True if file is contained in the found directory.
;------------------------------------------------------------------------------
isFileInDirectory(fileName, directoryPath)
{
    ; Ensure the directory exists
    if !DirExist(directoryPath) {
        return false
    }

    ; Construct full file path
    filePath := directoryPath "\" fileName

    ; Check if the file exists
    return FileExist(filePath)
}

;------------------------------------------------------------------------------
; @function addQuotesToString()
; @details  Appends double quotes to front and back of string.
; @return   Input string with double quotes around it.
;------------------------------------------------------------------------------
addQuotesToString(string)
{
    return '"' string '"'
}

;------------------------------------------------------------------------------
; @function getDefaultDirectory()
; @details  Figures out a default directory depending on system ENV vars and
;           existence of fallback directories.
; @return   Default directory as a string.
;------------------------------------------------------------------------------
getDefaultDirectory()
{
    defaultDirectory := EnvGet("MACROPAD_DEFAULT_FOLDER")
    if defaultDirectory == "" {
        if (DirExist("C:\\dev\\")) {
            defaultDirectory := "C:\\dev\\"
        } else {
            defaultDirectory := "C:\\"
        }
    }
    return defaultDirectory
}