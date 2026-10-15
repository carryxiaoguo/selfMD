; Markdown 文件关联的安装期补充。
;
; electron-builder 的 `fileAssociations` 已经写好了 ProgID、图标与
; `shell\open\command`，但**不会写 ShellNew**——没有它，资源管理器的
; 「右键 → 新建」里就不会出现「Markdown 文档」。
;
; 这里只补 ShellNew，并顺手把 `.md` 的默认 ProgID 指向自己。
;
; ## 为什么全写 HKCU
;
; ShellNew 是"当前用户的新建菜单里有什么"，本来就该按用户写；
; 而且 HKCU 不需要管理员权限，即使用户把程序装到了 Program Files，
; 这一段也不会因为权限不足而失败。
;
; ## Windows 10 之后的限制（写在这里免得以后误以为没生效）
;
; 从 Win10 起，**默认程序由用户的 UserChoice 决定，安装程序改不了**。
; 下面那句把 `.md` 的默认值指向 selfMD 只在用户**从未为 .md 选过**
; 默认程序时有效；已经选过的话，UserChoice 的优先级更高，Windows 会忽略它。
; 所以应用里另有一条命令引导用户去系统设置里确认——那是唯一可靠的办法。

!macro customInstall
  ; 「新建」菜单里的条目。NullFile 表示"创建一个空文件"。
  WriteRegStr HKCU "Software\Classes\.md\ShellNew" "NullFile" ""
  WriteRegStr HKCU "Software\Classes\.markdown\ShellNew" "NullFile" ""
  WriteRegStr HKCU "Software\Classes\.mdown\ShellNew" "NullFile" ""

  ; 让 Explorer 在「新建」菜单里显示中文名而不是裸扩展名。
  ; 这两句与 electron-builder 写的是同一处，重复写一遍没有副作用，
  ; 但如果哪天它的行为变了，这里能兜住。
  WriteRegStr HKCU "Software\Classes\.md" "" "selfMD.md"
  WriteRegStr HKCU "Software\Classes\selfMD.md" "" "Markdown 文档"
!macroend

!macro customUnInstall
  ; 卸载时把 ShellNew 清掉，否则「新建」菜单里会留一个
  ; 指向已删除程序的死条目——点了没反应，还会让人以为系统坏了。
  DeleteRegKey HKCU "Software\Classes\.md\ShellNew"
  DeleteRegKey HKCU "Software\Classes\.markdown\ShellNew"
  DeleteRegKey HKCU "Software\Classes\.mdown\ShellNew"

  ; 只在默认值确实指向自己时才删，避免把用户后来选的别的程序抹掉
  ReadRegStr $0 HKCU "Software\Classes\.md" ""
  StrCmp $0 "selfMD.md" 0 +2
    DeleteRegValue HKCU "Software\Classes\.md" ""
!macroend
