!macro KillAstraShell
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM AstraShell.exe'
  Pop $0
!macroend

!macro customHeader
  CRCCheck off
!macroend

!macro customCheckAppRunning
  StrCpy $R1 0
loop:
  nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq AstraShell.exe" /FO CSV | "$SYSDIR\find.exe" /I "AstraShell.exe"`
  Pop $R0
  ${if} $R0 != 0
    Goto done
  ${endif}

  DetailPrint "AstraShell.exe is running, attempting to stop it."
  !insertmacro KillAstraShell
  Sleep 1200

  IntOp $R1 $R1 + 1
  ${if} $R1 < 3
    Goto loop
  ${endif}

  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY loop
  Quit
done:
!macroend

!macro customInit
  !insertmacro KillAstraShell
  DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}"
  !endif
  DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
!macroend

!macro customUnInit
  !insertmacro KillAstraShell
!macroend

!macro customUnInstall
  !insertmacro KillAstraShell
!macroend

!macro customUnInstallCheck
  StrCmp $R0 0 done
  DetailPrint "Previous uninstaller exited with code $R0. Continue with forced cleanup."
  !insertmacro KillAstraShell
  ClearErrors
  StrCpy $R0 0
done:
!macroend
