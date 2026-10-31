; Minimal purple branding on the native assisted Windows installer.
!define MUI_BGCOLOR "FCFBFE"
!define MUI_TEXTCOLOR "252340"
!define MUI_ABORTWARNING

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎使用 SuperVPN"
  !define MUI_WELCOMEPAGE_TEXT "简洁的 Windows 代理客户端。$\r$\n$\r$\n安装向导将帮助你完成安装。你可以选择安装位置，软件更新会保留已有的节点和设置。$\r$\n$\r$\n点击“下一步”继续。"
  !insertmacro MUI_PAGE_WELCOME
!macroend
