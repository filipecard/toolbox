; ToolBox — Tauri 2.11 NSIS template (tauri-bundler installer.nsi) with the
; setup pages from the "ToolBox" block below. Keep in sync with Tauri when
; upgrading the CLI.
Unicode true
ManifestDPIAware true
; Add in `dpiAwareness` `PerMonitorV2` to manifest for Windows 10 1607+ (note this should not affect lower versions since they should be able to ignore this and pick up `dpiAware` `true` set by `ManifestDPIAware true`)
; Currently undocumented on NSIS's website but is in the Docs folder of source tree, see
; https://github.com/kichik/nsis/blob/5fc0b87b819a9eec006df4967d08e522ddd651c9/Docs/src/attributes.but#L286-L300
; https://github.com/tauri-apps/tauri/pull/10106
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  ; Set the compression algorithm. We default to LZMA.
  SetCompressor /SOLID "{{compression}}"
!endif

; Keep above !include to stay ahead of any plugin command
; see https://github.com/tauri-apps/tauri/pull/15422#discussion_r3289239624
{{#if signed_plugins_path}}
!addplugindir "{{signed_plugins_path}}"
{{/if}}

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "StrFunc.nsh"
${StrCase}
${StrLoc}

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define UNINSTALLERICON "{{uninstaller_icon}}"
!define UNINSTALLERHEADERIMAGE "{{uninstaller_header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var WixMode
Var OldMainBinaryName

Name "${PRODUCTNAME}"
BrandingText "${COPYRIGHT}"
OutFile "${OUTFILE}"

; We don't actually use this value as default install path,
; it's just for nsis to append the product name folder in the directory selector
; https://nsis.sourceforge.io/Reference/InstallDir
!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

# additional plugins
!addplugindir "${ADDITIONALPLUGINSPATH}"

; Uninstaller signing command
!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

; Handle install mode, `perUser`, `perMachine` or `both`
!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

; Installer icon
!if "${INSTALLERICON}" != ""
  !define MUI_ICON "${INSTALLERICON}"
!endif

; Installer sidebar image
!if "${SIDEBARIMAGE}" != ""
  !define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"
!endif

; Enable header images for installer and uninstaller pages when either image is configured.
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!else if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE
!endif

; Installer header image
!if "${HEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_BITMAP "${HEADERIMAGE}"
!endif

; Uninstaller header image
!if "${UNINSTALLERHEADERIMAGE}" != ""
  !define MUI_HEADERIMAGE_UNBITMAP "${UNINSTALLERHEADERIMAGE}"
!endif

; Uninstaller icon
!if "${UNINSTALLERICON}" != ""
  !define MUI_UNICON "${UNINSTALLERICON}"
!endif

; Define registry key to store installer language
!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

; Installer pages, must be ordered as they appear
; 1. Welcome Page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_WELCOME

; 2. License Page (if defined)
!if "${LICENSE}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!endif

; ---------------------------------------------------------------------------
; ToolBox: setup pages (install type → tools → theme → options).
; The choices are written to %APPDATA%\<bundle id>\installer-setup.json and
; applied by the app on its first start (commands/setup.rs), then deleted.
; "Iniciar com o Windows" is the same HKCU Run value the app's Settings
; toggle and the uninstaller use ("${PRODUCTNAME}").
; Skipped for passive/silent installs and updates (they keep the user's
; current configuration).
; ---------------------------------------------------------------------------
!include nsDialogs.nsh
!include LogicLib.nsh

Var TbCustom        ; 1 = "Personalizada", 0 = "Recomendada"
Var TbRadioRec
Var TbRadioCustom
Var TbTheme         ; theme preset id
Var TbAutostart     ; ${BST_CHECKED} / ${BST_UNCHECKED}
Var TbDesktop
Var TbChkAutostart
Var TbChkDesktop
Var TbAskedSetup    ; 1 when the setup pages ran (fresh GUI install)

; 12 tools: checkbox handle + state
!macro TB_TOOL_VARS n
  Var TbToolChk${n}
  Var TbToolOn${n}
!macroend
!insertmacro TB_TOOL_VARS 1
!insertmacro TB_TOOL_VARS 2
!insertmacro TB_TOOL_VARS 3
!insertmacro TB_TOOL_VARS 4
!insertmacro TB_TOOL_VARS 5
!insertmacro TB_TOOL_VARS 6
!insertmacro TB_TOOL_VARS 7
!insertmacro TB_TOOL_VARS 8
!insertmacro TB_TOOL_VARS 9
!insertmacro TB_TOOL_VARS 10
!insertmacro TB_TOOL_VARS 11
!insertmacro TB_TOOL_VARS 12

; 8 themes: radio handle
!macro TB_THEME_VARS n
  Var TbThemeRadio${n}
!macroend
!insertmacro TB_THEME_VARS 1
!insertmacro TB_THEME_VARS 2
!insertmacro TB_THEME_VARS 3
!insertmacro TB_THEME_VARS 4
!insertmacro TB_THEME_VARS 5
!insertmacro TB_THEME_VARS 6
!insertmacro TB_THEME_VARS 7
!insertmacro TB_THEME_VARS 8

Function TbInitDefaults
  StrCpy $TbCustom 0
  StrCpy $TbTheme "default"
  StrCpy $TbAutostart ${BST_CHECKED}
  StrCpy $TbDesktop ${BST_CHECKED}
  StrCpy $TbAskedSetup 0
  StrCpy $TbToolOn1 ${BST_CHECKED}
  StrCpy $TbToolOn2 ${BST_CHECKED}
  StrCpy $TbToolOn3 ${BST_CHECKED}
  StrCpy $TbToolOn4 ${BST_CHECKED}
  StrCpy $TbToolOn5 ${BST_CHECKED}
  StrCpy $TbToolOn6 ${BST_CHECKED}
  StrCpy $TbToolOn7 ${BST_CHECKED}
  StrCpy $TbToolOn8 ${BST_CHECKED}
  StrCpy $TbToolOn9 ${BST_CHECKED}
  StrCpy $TbToolOn10 ${BST_CHECKED}
  StrCpy $TbToolOn11 ${BST_CHECKED}
  StrCpy $TbToolOn12 ${BST_CHECKED}
FunctionEnd

Function TbSkipSetup
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
  ${OrIf} ${Silent}
    Abort
  ${EndIf}
FunctionEnd

; --- Page A: install type ---------------------------------------------------
Page custom TbPageType TbPageTypeLeave
Function TbPageType
  Call TbSkipSetup
  StrCpy $TbAskedSetup 1
  !insertmacro MUI_HEADER_TEXT "Como você quer instalar?" "Escolha uma configuração pronta ou monte a sua."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateRadioButton} 0 6u 100% 12u "Recomendada"
  Pop $TbRadioRec
  ${NSD_CreateLabel} 14u 20u 95% 26u "Todas as ferramentas, tema Padrão e o ToolBox iniciando junto com o Windows. Componentes pesados (leitura de imagem, voz) só são baixados quando você usar."
  Pop $0
  ${NSD_CreateRadioButton} 0 54u 100% 12u "Personalizada"
  Pop $TbRadioCustom
  ${NSD_CreateLabel} 14u 68u 95% 26u "Escolha quais ferramentas instalar, o tema de cores e se o ToolBox inicia com o Windows."
  Pop $0
  ${If} $TbCustom = 1
    ${NSD_Check} $TbRadioCustom
  ${Else}
    ${NSD_Check} $TbRadioRec
  ${EndIf}
  nsDialogs::Show
FunctionEnd
Function TbPageTypeLeave
  ${NSD_GetState} $TbRadioCustom $0
  ${If} $0 = ${BST_CHECKED}
    StrCpy $TbCustom 1
  ${Else}
    StrCpy $TbCustom 0
    Call TbInitDefaults
    StrCpy $TbAskedSetup 1
  ${EndIf}
FunctionEnd

; --- Page B: tools ----------------------------------------------------------
!macro TB_TOOL n x y label
  ${NSD_CreateCheckbox} ${x} ${y} 48% 12u "${label}"
  Pop $TbToolChk${n}
  ${NSD_SetState} $TbToolChk${n} $TbToolOn${n}
!macroend
!macro TB_TOOL_READ n
  ${NSD_GetState} $TbToolChk${n} $TbToolOn${n}
!macroend

Page custom TbPageTools TbPageToolsLeave
Function TbPageTools
  Call TbSkipSetup
  ${IfThen} $TbCustom <> 1 ${|} Abort ${|}
  !insertmacro MUI_HEADER_TEXT "Ferramentas" "Marque as ferramentas que deseja instalar."
  nsDialogs::Create 1018
  Pop $0
  !insertmacro TB_TOOL 1 0 2u "Calculadora"
  !insertmacro TB_TOOL 2 0 17u "Notas"
  !insertmacro TB_TOOL 3 0 32u "Leitor de imagem (+60 MB)"
  !insertmacro TB_TOOL 4 0 47u "Seletor de cor"
  !insertmacro TB_TOOL 5 0 62u "Conversor"
  !insertmacro TB_TOOL 6 0 77u "Clipboard"
  !insertmacro TB_TOOL 7 52% 2u "Utilitários"
  !insertmacro TB_TOOL 8 52% 17u "Compressor"
  !insertmacro TB_TOOL 9 52% 32u "Tradutor"
  !insertmacro TB_TOOL 10 52% 47u "Transcrição de áudio (+150 MB)"
  !insertmacro TB_TOOL 11 52% 62u "Lembretes/Timer"
  !insertmacro TB_TOOL 12 52% 77u "Busca de arquivos"
  ${NSD_CreateLabel} 0 100u 100% 24u "As desmarcadas não são instaladas. Instale ou remova ferramentas quando quiser em Configurações → Ferramentas. O tamanho entre parênteses é baixado no primeiro uso."
  Pop $0
  nsDialogs::Show
FunctionEnd
Function TbPageToolsLeave
  !insertmacro TB_TOOL_READ 1
  !insertmacro TB_TOOL_READ 2
  !insertmacro TB_TOOL_READ 3
  !insertmacro TB_TOOL_READ 4
  !insertmacro TB_TOOL_READ 5
  !insertmacro TB_TOOL_READ 6
  !insertmacro TB_TOOL_READ 7
  !insertmacro TB_TOOL_READ 8
  !insertmacro TB_TOOL_READ 9
  !insertmacro TB_TOOL_READ 10
  !insertmacro TB_TOOL_READ 11
  !insertmacro TB_TOOL_READ 12
  ${If} $TbToolOn1$TbToolOn2$TbToolOn3$TbToolOn4$TbToolOn5$TbToolOn6$TbToolOn7$TbToolOn8$TbToolOn9$TbToolOn10$TbToolOn11$TbToolOn12 == "000000000000"
    MessageBox MB_ICONEXCLAMATION "Marque pelo menos uma ferramenta."
    Abort
  ${EndIf}
FunctionEnd

; --- Page C: theme — the whole page takes the picked theme's colors, with a
; small tool window as the preview, repainted on every click. ---------------
Var TbPage
Var TbPvHint
!macro TB_THEME_LABEL_VAR n
  Var TbThemeLabel${n}
!macroend
!insertmacro TB_THEME_LABEL_VAR 1
!insertmacro TB_THEME_LABEL_VAR 2
!insertmacro TB_THEME_LABEL_VAR 3
!insertmacro TB_THEME_LABEL_VAR 4
!insertmacro TB_THEME_LABEL_VAR 5
!insertmacro TB_THEME_LABEL_VAR 6
!insertmacro TB_THEME_LABEL_VAR 7
!insertmacro TB_THEME_LABEL_VAR 8
Var TbPvBody
Var TbPvTitle
Var TbPvClose
Var TbPvInput
Var TbPvText
Var TbPvB1
Var TbPvB2
Var TbPvB3
Var TbPvB4
Var TbPvB5
Var TbPvB6

; SetCtlColors takes its colors at compile time (a variable compiles to
; 000000), so each theme gets its own block with the colors written in.
!macro TB_PAINT_ITEM n text bg
  SetCtlColors $TbThemeRadio${n} "${text}" "${bg}"
  SetCtlColors $TbThemeLabel${n} "${text}" "${bg}"
!macroend
!macro TB_PAINT_THEME id bg text accent header button input
  ${If} $R0 == "${id}"
    SetCtlColors $TbPage "${text}" "${bg}"
    !insertmacro TB_PAINT_ITEM 1 "${text}" "${bg}"
    !insertmacro TB_PAINT_ITEM 2 "${text}" "${bg}"
    !insertmacro TB_PAINT_ITEM 3 "${text}" "${bg}"
    !insertmacro TB_PAINT_ITEM 4 "${text}" "${bg}"
    !insertmacro TB_PAINT_ITEM 5 "${text}" "${bg}"
    !insertmacro TB_PAINT_ITEM 6 "${text}" "${bg}"
    !insertmacro TB_PAINT_ITEM 7 "${text}" "${bg}"
    !insertmacro TB_PAINT_ITEM 8 "${text}" "${bg}"
    SetCtlColors $TbPvHint "${text}" "${bg}"
    SetCtlColors $TbPvBody "${text}" "${bg}"
    SetCtlColors $TbPvTitle "${text}" "${header}"
    SetCtlColors $TbPvClose "ffffff" "${accent}"
    SetCtlColors $TbPvInput "${text}" "${input}"
    SetCtlColors $TbPvText "${text}" "${bg}"
    SetCtlColors $TbPvB1 "${text}" "${button}"
    SetCtlColors $TbPvB2 "${text}" "${button}"
    SetCtlColors $TbPvB3 "${text}" "${button}"
    SetCtlColors $TbPvB4 "${text}" "${button}"
    SetCtlColors $TbPvB5 "${text}" "${button}"
    SetCtlColors $TbPvB6 "${text}" "${button}"
  ${EndIf}
!macroend
; $R0 = theme id. Same colors as THEME_PRESETS in src/shared/settingsStore.ts.
Function TbPaintPage
  !insertmacro TB_PAINT_THEME "default"  "000000" "ffffff" "d70909" "171716" "174e59" "24262c"
  !insertmacro TB_PAINT_THEME "dark"     "1e1f24" "f2f2f2" "d94f4f" "16171b" "2b2d33" "24262c"
  !insertmacro TB_PAINT_THEME "light"    "f4f5f7" "1f2328" "d73a49" "e2e5e9" "d9dee4" "ffffff"
  !insertmacro TB_PAINT_THEME "contrast" "000000" "ffff00" "ff3b3b" "000000" "1f1f1f" "000000"
  !insertmacro TB_PAINT_THEME "ocean"    "0f2a3d" "e6f4ff" "ff7a59" "0a1f2e" "1b4965" "143650"
  !insertmacro TB_PAINT_THEME "sunset"   "2d1b3d" "ffe8d6" "ff6b6b" "1f1230" "5a2d5c" "3a2450"
  !insertmacro TB_PAINT_THEME "forest"   "1b2a1f" "e8f5e9" "f4a261" "13201a" "2d4a35" "22382a"
  !insertmacro TB_PAINT_THEME "candy"    "fff4f8" "4a2c40" "e0457b" "ffd9e6" "f7c8dc" "ffffff"
  ; Repaint the page and every control on it right away
  ; (RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW).
  System::Call "user32::RedrawWindow(p $TbPage, p 0, p 0, i 0x185)"
FunctionEnd

; Clicking a radio circle.
Function TbThemeClicked
  Pop $0
  nsDialogs::GetUserData $0
  Pop $R0
  StrCpy $TbTheme $R0
  Call TbPaintPage
FunctionEnd

; Clicking a theme's name. A radio's own text can't take the theme's color
; (Windows visual styles ignore it), so the name is a separate label.
!macro TB_THEME_SYNC n
  nsDialogs::GetUserData $TbThemeRadio${n}
  Pop $1
  ${If} $1 == $R0
    ${NSD_Check} $TbThemeRadio${n}
  ${Else}
    ${NSD_Uncheck} $TbThemeRadio${n}
  ${EndIf}
!macroend
Function TbThemeLabelClicked
  Pop $0
  nsDialogs::GetUserData $0
  Pop $R0
  StrCpy $TbTheme $R0
  !insertmacro TB_THEME_SYNC 1
  !insertmacro TB_THEME_SYNC 2
  !insertmacro TB_THEME_SYNC 3
  !insertmacro TB_THEME_SYNC 4
  !insertmacro TB_THEME_SYNC 5
  !insertmacro TB_THEME_SYNC 6
  !insertmacro TB_THEME_SYNC 7
  !insertmacro TB_THEME_SYNC 8
  Call TbPaintPage
FunctionEnd

!macro TB_THEME n id label y
  ${NSD_CreateRadioButton} 0 ${y} 11u 12u ""
  Pop $TbThemeRadio${n}
  nsDialogs::SetUserData $TbThemeRadio${n} "${id}"
  ${NSD_OnClick} $TbThemeRadio${n} TbThemeClicked
  ${If} $TbTheme == "${id}"
    ${NSD_Check} $TbThemeRadio${n}
  ${EndIf}
  ; SS_NOTIFY (clickable) | SS_CENTERIMAGE (vertically centered)
  nsDialogs::CreateControl STATIC ${WS_CHILD}|${WS_VISIBLE}|0x300 0 12u ${y} 88u 12u "${label}"
  Pop $TbThemeLabel${n}
  nsDialogs::SetUserData $TbThemeLabel${n} "${id}"
  ${NSD_OnClick} $TbThemeLabel${n} TbThemeLabelClicked
!macroend
; Static text vertically centered (SS_CENTERIMAGE), optionally centered
; horizontally too (SS_CENTER).
!macro TB_PV var x y w h text center
  nsDialogs::CreateControl STATIC ${WS_CHILD}|${WS_VISIBLE}|0x200|${center} 0 ${x} ${y} ${w} ${h} "${text}"
  Pop ${var}
!macroend

Page custom TbPageTheme TbPageThemeLeave
Function TbPageTheme
  Call TbSkipSetup
  ${IfThen} $TbCustom <> 1 ${|} Abort ${|}
  !insertmacro MUI_HEADER_TEXT "Aparência" "Clique em um tema: esta área mostra como o ToolBox vai ficar."
  nsDialogs::Create 1018
  Pop $TbPage
  !insertmacro TB_THEME 1 "default" "Padrão" 4u
  !insertmacro TB_THEME 2 "dark" "Escuro" 18u
  !insertmacro TB_THEME 3 "light" "Claro" 32u
  !insertmacro TB_THEME 4 "contrast" "Alto contraste" 46u
  !insertmacro TB_THEME 5 "ocean" "Oceano" 60u
  !insertmacro TB_THEME 6 "sunset" "Pôr do sol" 74u
  !insertmacro TB_THEME 7 "forest" "Floresta" 88u
  !insertmacro TB_THEME 8 "candy" "Pastel" 102u

  ; Preview: a small tool window (title bar, text field, text, buttons).
  !insertmacro TB_PV $TbPvTitle 112u 4u 172u 14u "   Calculadora" 0
  !insertmacro TB_PV $TbPvClose 284u 4u 16u 14u "×" 1
  !insertmacro TB_PV $TbPvInput 120u 26u 172u 16u "   1.250 + 380" 0
  !insertmacro TB_PV $TbPvText 120u 46u 172u 12u "Resultado: 1.630" 0
  !insertmacro TB_PV $TbPvB1 120u 64u 40u 16u "7" 1
  !insertmacro TB_PV $TbPvB2 164u 64u 40u 16u "8" 1
  !insertmacro TB_PV $TbPvB3 208u 64u 40u 16u "9" 1
  !insertmacro TB_PV $TbPvB4 252u 64u 40u 16u "+" 1
  !insertmacro TB_PV $TbPvB5 120u 86u 84u 16u "Copiar" 1
  !insertmacro TB_PV $TbPvB6 208u 86u 84u 16u "Limpar" 1
  ; The window body goes behind everything above and never paints over it.
  nsDialogs::CreateControl STATIC ${WS_CHILD}|${WS_VISIBLE}|${WS_CLIPSIBLINGS} 0 112u 4u 188u 108u ""
  Pop $TbPvBody
  System::Call "user32::SetWindowPos(p $TbPvBody, p 1, i 0, i 0, i 0, i 0, i 0x13)" ; HWND_BOTTOM, no move/size/activate

  ${NSD_CreateLabel} 0 118u 100% 20u "Depois, em Configurações → Tema, dá para trocar o tema, ajustar cada cor, a fonte e o tamanho."
  Pop $TbPvHint

  StrCpy $R0 $TbTheme
  Call TbPaintPage
  nsDialogs::Show
FunctionEnd
!macro TB_THEME_READ n
  ${NSD_GetState} $TbThemeRadio${n} $0
  ${If} $0 = ${BST_CHECKED}
    nsDialogs::GetUserData $TbThemeRadio${n}
    Pop $TbTheme
  ${EndIf}
!macroend
Function TbPageThemeLeave
  !insertmacro TB_THEME_READ 1
  !insertmacro TB_THEME_READ 2
  !insertmacro TB_THEME_READ 3
  !insertmacro TB_THEME_READ 4
  !insertmacro TB_THEME_READ 5
  !insertmacro TB_THEME_READ 6
  !insertmacro TB_THEME_READ 7
  !insertmacro TB_THEME_READ 8
FunctionEnd

; --- Page D: options --------------------------------------------------------
Page custom TbPageOptions TbPageOptionsLeave
Function TbPageOptions
  Call TbSkipSetup
  ${IfThen} $TbCustom <> 1 ${|} Abort ${|}
  !insertmacro MUI_HEADER_TEXT "Opções" "Últimos detalhes antes de instalar."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateCheckbox} 0 4u 100% 12u "Iniciar o ToolBox junto com o Windows"
  Pop $TbChkAutostart
  ${NSD_SetState} $TbChkAutostart $TbAutostart
  ${NSD_CreateLabel} 14u 17u 95% 18u "A bolinha aparece no canto da tela assim que você entra no Windows. Pode desligar depois nas Configurações."
  Pop $0
  ${NSD_CreateCheckbox} 0 42u 100% 12u "Criar atalho na área de trabalho"
  Pop $TbChkDesktop
  ${NSD_SetState} $TbChkDesktop $TbDesktop
  ${NSD_CreateLabel} 0 70u 100% 30u "Dica: o menu rápido abre com Ctrl + Alt + Espaço em qualquer programa. Na primeira vez que abrir, o ToolBox pede para entrar na sua conta pelo navegador."
  Pop $0
  nsDialogs::Show
FunctionEnd
Function TbPageOptionsLeave
  ${NSD_GetState} $TbChkAutostart $TbAutostart
  ${NSD_GetState} $TbChkDesktop $TbDesktop
FunctionEnd

; --- Applying the choices (called from Section Install) --------------------
!macro TB_JSON_TOOL n id
  ${If} $TbToolOn${n} = ${BST_CHECKED}
    ${If} $1 != ""
      StrCpy $1 '$1,'
    ${EndIf}
    StrCpy $1 '$1"${id}"'
  ${EndIf}
!macroend

Function TbApplySetup
  ${If} $TbAskedSetup <> 1
    Return
  ${EndIf}

  ; Start with Windows (same value the app's Settings toggle writes).
  ${If} $TbAutostart = ${BST_CHECKED}
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe" --autostart'
  ${Else}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ${If} $TbDesktop = ${BST_CHECKED}
  ${AndIf} $NoShortcutMode <> 1
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  ; First-start configuration for the app.
  StrCpy $1 ""
  !insertmacro TB_JSON_TOOL 1 "calculator"
  !insertmacro TB_JSON_TOOL 2 "notes"
  !insertmacro TB_JSON_TOOL 3 "ocr"
  !insertmacro TB_JSON_TOOL 4 "color-picker"
  !insertmacro TB_JSON_TOOL 5 "converter"
  !insertmacro TB_JSON_TOOL 6 "clipboard"
  !insertmacro TB_JSON_TOOL 7 "devtools"
  !insertmacro TB_JSON_TOOL 8 "compressor"
  !insertmacro TB_JSON_TOOL 9 "translator"
  !insertmacro TB_JSON_TOOL 10 "transcribe"
  !insertmacro TB_JSON_TOOL 11 "reminders"
  !insertmacro TB_JSON_TOOL 12 "file-search"
  ${If} $TbAutostart = ${BST_CHECKED}
    StrCpy $2 "true"
  ${Else}
    StrCpy $2 "false"
  ${EndIf}
  SetShellVarContext current
  CreateDirectory "$APPDATA\${BUNDLEID}"
  FileOpen $0 "$APPDATA\${BUNDLEID}\installer-setup.json" w
  FileWrite $0 '{"version":1,"tools":[$1],"theme":"$TbTheme","autostart":$2}'
  FileClose $0
FunctionEnd

; 3. Install mode (if it is set to `both`)
!if "${INSTALLMODE}" == "both"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !insertmacro MULTIUSER_PAGE_INSTALLMODE
!endif

; 4. Custom page to ask user if he wants to reinstall/uninstall
;    only if a previous installation was detected
Var ReinstallPageCheck
Page custom PageReinstall PageLeaveReinstall
Function PageReinstall
  ; Uninstall previous WiX installation if exists.
  ;
  ; A WiX installer stores the installation info in registry
  ; using a UUID and so we have to loop through all keys under
  ; `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`
  ; and check if `DisplayName` and `Publisher` keys match ${PRODUCTNAME} and ${MANUFACTURER}
  ;
  ; This has a potential issue that there maybe another installation that matches
  ; our ${PRODUCTNAME} and ${MANUFACTURER} but wasn't installed by our WiX installer,
  ; however, this should be fine since the user will have to confirm the uninstallation
  ; and they can chose to abort it if doesn't make sense.
  StrCpy $0 0
  wix_loop:
    EnumRegKey $1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" wix_loop_done ; Exit loop if there is no more keys to loop on
    IntOp $0 $0 + 1
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "Publisher"
    StrCmp "$R0$R1" "${PRODUCTNAME}${MANUFACTURER}" 0 wix_loop
    ReadRegStr $R0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1" "UninstallString"
    ${StrCase} $R1 $R0 "L"
    ${StrLoc} $R0 $R1 "msiexec" ">"
    StrCmp $R0 0 0 wix_loop_done
    StrCpy $WixMode 1
    StrCpy $R6 "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$1"
    Goto compare_version
  wix_loop_done:

  ; Check if there is an existing installation, if not, abort the reinstall page
  ReadRegStr $R0 SHCTX "${UNINSTKEY}" ""
  ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
  ${IfThen} "$R0$R1" == "" ${|} Abort ${|}

  ; Compare this installar version with the existing installation
  ; and modify the messages presented to the user accordingly
  compare_version:
  StrCpy $R4 "$(older)"
  ${If} $WixMode = 1
    ReadRegStr $R0 HKLM "$R6" "DisplayVersion"
  ${Else}
    ReadRegStr $R0 SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${EndIf}
  ${IfThen} $R0 == "" ${|} StrCpy $R4 "$(unknown)" ${|}

  nsis_tauri_utils::SemverCompare "${VERSION}" $R0
  Pop $R0
  ; Reinstalling the same version
  ${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
  ; Upgrading
  ${ElseIf} $R0 = 1
    StrCpy $R1 "$(olderOrUnknownVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(dontUninstall)"
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ; Downgrading
  ${ElseIf} $R0 = -1
    StrCpy $R1 "$(newerVersionInstalled)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    !if "${ALLOWDOWNGRADES}" == "true"
      StrCpy $R3 "$(dontUninstall)"
    !else
      StrCpy $R3 "$(dontUninstallDowngrade)"
    !endif
    !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(choowHowToInstall)"
  ${Else}
    Abort
  ${EndIf}

  ; Skip showing the page if passive
  ;
  ; Note that we don't call this earlier at the begining
  ; of this function because we need to populate some variables
  ; related to current installed version if detected and whether
  ; we are downgrading or not.
  ${If} $PassiveMode = 1
    Call PageLeaveReinstall
  ${Else}
    nsDialogs::Create 1018
    Pop $R4
    ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}

    ${NSD_CreateLabel} 0 0 100% 24u $R1
    Pop $R1

    ${NSD_CreateRadioButton} 30u 50u -30u 8u $R2
    Pop $R2
    ${NSD_OnClick} $R2 PageReinstallUpdateSelection

    ${NSD_CreateRadioButton} 30u 70u -30u 8u $R3
    Pop $R3
    ; Disable this radio button if downgrading and downgrades are disabled
    !if "${ALLOWDOWNGRADES}" == "false"
      ${IfThen} $R0 = -1 ${|} EnableWindow $R3 0 ${|}
    !endif
    ${NSD_OnClick} $R3 PageReinstallUpdateSelection

    ; Check the first radio button if this the first time
    ; we enter this page or if the second button wasn't
    ; selected the last time we were on this page
    ${If} $ReinstallPageCheck <> 2
      SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${Else}
      SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${EndIf}

    ${NSD_SetFocus} $R2
    nsDialogs::Show
  ${EndIf}
FunctionEnd
Function PageReinstallUpdateSelection
  ${NSD_GetState} $R2 $R1
  ${If} $R1 == ${BST_CHECKED}
    StrCpy $ReinstallPageCheck 1
  ${Else}
    StrCpy $ReinstallPageCheck 2
  ${EndIf}
FunctionEnd
Function PageLeaveReinstall
  ${NSD_GetState} $R2 $R1

  ; If migrating from Wix, always uninstall
  ${If} $WixMode = 1
    Goto reinst_uninstall
  ${EndIf}

  ; In update mode, always proceeds without uninstalling
  ${If} $UpdateMode = 1
    Goto reinst_done
  ${EndIf}

  ; $R0 holds whether same(0)/upgrading(1)/downgrading(-1) version
  ; $R1 holds the radio buttons state:
  ;   1 => first choice was selected
  ;   0 => second choice was selected
  ${If} $R0 = 0 ; Same version, proceed
    ${If} $R1 = 1              ; User chose to add/reinstall
      Goto reinst_done
    ${Else}                    ; User chose to uninstall
      Goto reinst_uninstall
    ${EndIf}
  ${ElseIf} $R0 = 1 ; Upgrading
    ${If} $R1 = 1              ; User chose to uninstall
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done         ; User chose NOT to uninstall
    ${EndIf}
  ${ElseIf} $R0 = -1 ; Downgrading
    ${If} $R1 = 1              ; User chose to uninstall
      Goto reinst_uninstall
    ${Else}
      Goto reinst_done         ; User chose NOT to uninstall
    ${EndIf}
  ${EndIf}

  reinst_uninstall:
    HideWindow
    ClearErrors

    ${If} $WixMode = 1
      ReadRegStr $R1 HKLM "$R6" "UninstallString"
      ExecWait '$R1' $0
    ${Else}
      ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
      ReadRegStr $R1 SHCTX "${UNINSTKEY}" "UninstallString"
      ${IfThen} $UpdateMode = 1 ${|} StrCpy $R1 "$R1 /UPDATE" ${|} ; append /UPDATE
      ${IfThen} $PassiveMode = 1 ${|} StrCpy $R1 "$R1 /P" ${|} ; append /P
      StrCpy $R1 "$R1 _?=$4" ; append uninstall directory
      ExecWait '$R1' $0
    ${EndIf}

    BringToFront

    ${IfThen} ${Errors} ${|} StrCpy $0 2 ${|} ; ExecWait failed, set fake exit code

    ${If} $0 <> 0
    ${OrIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
      ; User cancelled wix uninstaller? return to select un/reinstall page
      ${If} $WixMode = 1
      ${AndIf} $0 = 1602
        Abort
      ${EndIf}

      ; User cancelled NSIS uninstaller? return to select un/reinstall page
      ${If} $0 = 1
        Abort
      ${EndIf}

      ; Other erros? show generic error message and return to select un/reinstall page
      MessageBox MB_ICONEXCLAMATION "$(unableToUninstall)"
      Abort
    ${EndIf}
  reinst_done:
FunctionEnd

; 5. Choose install directory page
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_DIRECTORY

; 6. Start menu shortcut page
Var AppStartMenuFolder
!if "${STARTMENUFOLDER}" != ""
  !define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
  !define MUI_STARTMENUPAGE_DEFAULTFOLDER "${STARTMENUFOLDER}"
!else
  !define MUI_PAGE_CUSTOMFUNCTION_PRE Skip
!endif
!insertmacro MUI_PAGE_STARTMENU Application $AppStartMenuFolder

; 7. Installation page
!insertmacro MUI_PAGE_INSTFILES

; 8. Finish page
;
; Don't auto jump to finish page after installation page,
; because the installation page has useful info that can be used debug any issues with the installer.
!define MUI_FINISHPAGE_NOAUTOCLOSE
; ToolBox: the desktop shortcut is chosen on the "Opções" page instead.
; Show run app after installation.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH

Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
FunctionEnd

; Uninstaller Pages
; 1. Confirm uninstall page
Var DeleteAppDataCheckbox
Var DeleteAppDataCheckboxState
!define /ifndef WS_EX_LAYOUTRTL         0x00400000
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.ConfirmShow
Function un.ConfirmShow ; Add add a `Delete app data` check box
  ; $1 inner dialog HWND
  ; $2 window DPI
  ; $3 style
  ; $4 x
  ; $5 y
  ; $6 width
  ; $7 height
  FindWindow $1 "#32770" "" $HWNDPARENT ; Find inner dialog
  System::Call "user32::GetDpiForWindow(p r1) i .r2"
  ${If} $(^RTL) = 1
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE} | ${WS_EX_LAYOUTRTL}"
    IntOp $4 50 * $2
  ${Else}
    StrCpy $3 "${__NSD_CheckBox_EXSTYLE}"
    IntOp $4 0 * $2
  ${EndIf}
  IntOp $5 100 * $2
  IntOp $6 400 * $2
  IntOp $7 25 * $2
  IntOp $4 $4 / 96
  IntOp $5 $5 / 96
  IntOp $6 $6 / 96
  IntOp $7 $7 / 96
  System::Call 'user32::CreateWindowEx(i r3, w "${__NSD_CheckBox_CLASS}", w "$(deleteAppData)", i ${__NSD_CheckBox_STYLE}, i r4, i r5, i r6, i r7, p r1, i0, i0, i0) i .s'
  Pop $DeleteAppDataCheckbox
  SendMessage $HWNDPARENT ${WM_GETFONT} 0 0 $1
  SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $1 1
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE un.ConfirmLeave
Function un.ConfirmLeave
  SendMessage $DeleteAppDataCheckbox ${BM_GETCHECK} 0 0 $DeleteAppDataCheckboxState
FunctionEnd
!define MUI_PAGE_CUSTOMFUNCTION_PRE un.SkipIfPassive
!insertmacro MUI_UNPAGE_CONFIRM

; 2. Uninstalling Page
!insertmacro MUI_UNPAGE_INSTFILES

;Languages
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

Function .onInit
  Call TbInitDefaults
  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro SetContext

  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"
    ; Set default install location
    !if "${INSTALLMODE}" == "perMachine"
      ${If} ${RunningX64}
        !if "${ARCH}" == "x64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else if "${ARCH}" == "arm64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else
          StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
        !endif
      ${Else}
        StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
      ${EndIf}
    !else if "${INSTALLMODE}" == "currentUser"
      StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
    !endif

    Call RestorePreviousInstallLocation
  ${EndIf}


  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif
FunctionEnd


Section EarlyChecks
  ; Abort silent installer if downgrades is disabled
  !if "${ALLOWDOWNGRADES}" == "false"
  ${If} ${Silent}
    ; If downgrading
    ${If} $R0 = -1
      System::Call 'kernel32::AttachConsole(i -1)i.r0'
      ${If} $0 <> 0
        System::Call 'kernel32::GetStdHandle(i -11)i.r0'
        System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)' ; set red color
        FileWrite $0 "$(silentDowngrades)"
      ${EndIf}
      Abort
    ${EndIf}
  ${EndIf}
  !endif

SectionEnd

Section WebView2
  ; Check if Webview2 is already installed and skip this section
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}

  ${If} $4 == ""
    ; Webview2 installation
    ;
    ; Skip if updating
    ${If} $UpdateMode <> 1
      !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        DetailPrint "$(webview2Downloading)"
        NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Pop $0
        ${If} $0 == "success"
          DetailPrint "$(webview2DownloadSuccess)"
        ${Else}
          DetailPrint "$(webview2DownloadError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
        Delete "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        Goto install_webview2
      !endif

      Goto webview2_done

      install_webview2:
        DetailPrint "$(installingWebview2)"
        ; $6 holds the path to the webview2 installer
        ExecWait "$6 ${WEBVIEW2INSTALLERARGS} /install" $1
        ${If} $1 = 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          DetailPrint "$(webview2InstallError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
      webview2_done:
    ${EndIf}
  ${Else}
    !if "${MINIMUMWEBVIEW2VERSION}" != ""
      ${VersionCompare} "${MINIMUMWEBVIEW2VERSION}" "$4" $R0
      ${If} $R0 = 1
        update_webview:
          DetailPrint "$(installingWebview2)"
          ${If} ${RunningX64}
            ReadRegStr $R1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate" "path"
          ${Else}
            ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 == ""
            ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 != ""
            ; Chromium updater docs: https://source.chromium.org/chromium/chromium/src/+/main:docs/updater/user_manual.md
            ; Modified from "HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView\ModifyPath"
            ExecWait `"$R1" /install appguid=${WEBVIEW2APPGUID}&needsadmin=true` $1
            ${If} $1 = 0
              DetailPrint "$(webview2InstallSuccess)"
            ${Else}
              MessageBox MB_ICONEXCLAMATION|MB_ABORTRETRYIGNORE "$(webview2InstallError)" IDIGNORE ignore IDRETRY update_webview
              Quit
              ignore:
            ${EndIf}
          ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
SectionEnd

Section Install
  SetOutPath $INSTDIR

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; Copy main executable
  File "${MAINBINARYSRCPATH}"

  ; Copy resources
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
  {{/each}}

  ; Copy external binaries
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
  {{/each}}

  ; Create file associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$INSTDIR\${MAINBINARYNAME}.exe,0" "Open with ${PRODUCTNAME}" "$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\""
    {{/each}}
  {{/each}}

  ; Register deep links
  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Save $INSTDIR in registry for future installations
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  !if "${INSTALLMODE}" == "both"
    ; Save install mode to be selected by default for the next installation such as updating
    ; or when uninstalling
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ; Remove old main binary if it doesn't match new main binary name
  ReadRegStr $OldMainBinaryName SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\$OldMainBinaryName"
  ${EndIf}

  ; Save current MAINBINARYNAME for future updates
  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"

  ; Registry information for add/remove programs
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=uninstall.exe /S=0K /G=0" $0 $1 $2
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  ; Create start menu shortcut
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    Call CreateOrUpdateStartMenuShortcut
  !insertmacro MUI_STARTMENU_WRITE_END

  ; Create desktop shortcut for silent and passive installers
  ; because finish page will be skipped
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Call CreateOrUpdateDesktopShortcut
  ${EndIf}

  ; ToolBox: start with Windows, desktop shortcut, first-start settings.
  Call TbApplySetup

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  ; Auto close this page for passive mode
  ${If} $PassiveMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function .onInstSuccess
  ; Check for `/R` flag only in silent and passive installers because
  ; GUI installer has a toggle for the user to (re)start the app
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    ${GetOptions} $CMDLINE "/R" $R0
    ${IfNot} ${Errors}
      ${GetOptions} $CMDLINE "/ARGS" $R0
      nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" "$R0"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  !insertmacro SetContext

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
FunctionEnd

Section Uninstall

  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  ; Delete the app directory and its content from disk
  ; Copy main executable
  Delete "$INSTDIR\${MAINBINARYNAME}.exe"

  ; Delete resources
  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  ; Delete external binaries
  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  ; Delete app associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  ; Delete deep links
  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}


  ; Delete uninstaller
  Delete "$INSTDIR\uninstall.exe"

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"

  ; Remove shortcuts if not updating
  ${If} $UpdateMode <> 1
    !insertmacro DeleteAppUserModelId

    ; Remove start menu shortcut
    !insertmacro MUI_STARTMENU_GETFOLDER Application $AppStartMenuFolder
    !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
      RMDir "$SMPROGRAMS\$AppStartMenuFolder"
    ${EndIf}
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    ; Remove desktop shortcuts
    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  ; Remove registry information for add/remove programs
  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif

  ; Removes the Autostart entry for ${PRODUCTNAME} from the HKCU Run key if it exists.
  ; This ensures the program does not launch automatically after uninstallation if it exists.
  ; If it doesn't exist, it does nothing.
  ; We do this when not updating (to preserve the registry value on updates)
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ; Delete app data if the checkbox is selected
  ; and if not updating
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ; Clear the install location $INSTDIR from registry
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"

    ; Clear the install language from registry
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  ; Auto close if passive mode or updating
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    SetAutoClose true
  ${EndIf}
SectionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

Function Skip
  Abort
FunctionEnd

Function SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd
Function un.SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd

Function CreateOrUpdateStartMenuShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  StrCpy $R0 0

  !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  ${If} $R0 = 1
    Return
  ${EndIf}

  ; Skip creating shortcut if in update mode or no shortcut mode
  ; but always create if migrating from wix
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\$AppStartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  ; We used to use product name as MAINBINARYNAME
  ; migrate old shortcuts to target the new MAINBINARYNAME
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Return
  ${EndIf}

  ; Skip creating shortcut if in update mode or no shortcut mode
  ; but always create if migrating from wix
  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
