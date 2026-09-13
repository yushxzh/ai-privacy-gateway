; 更新时保留接入与证书；真正卸载前调用应用执行恢复和精确撤销。
!macro customUnInstall
  ${IfNot} ${isUpdated}
    ClearErrors
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --prepare-uninstall' $R0
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "无法启动接入清理。请先打开 Privacy Gateway 完成移除接入和证书，再重试卸载。" /SD IDOK
      SetErrorLevel 21
      Abort
    ${EndIf}
    ${If} $R0 != 0
      MessageBox MB_OK|MB_ICONSTOP "接入或证书尚未完全移除。请关闭网关后重试，或在应用设置中完成移除并检查 WorkBuddy 原模型地址。应用文件已保留。" /SD IDOK
      SetErrorLevel 21
      Abort
    ${EndIf}
  ${EndIf}
!macroend
