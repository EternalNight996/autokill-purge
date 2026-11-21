; autokill-purge 安装包（Inno Setup 6）
; 生成：ISCC.exe /DAppVersion=1.2.0 /DSourceDir=dist\autokill-purge-1.2.0-win-x64 scripts\installer.iss
#ifndef AppVersion
  #define AppVersion "1.2.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\autokill-purge-1.2.0-win-x64"
#endif

[Setup]
AppId={{8F2A6C41-3B7E-4D95-9C1A-5E7D2B4A9F13}
AppName=梦神破甲 autokill-purge
AppVersion={#AppVersion}
AppVerName=梦神破甲 autokill-purge {#AppVersion}
AppPublisher=eternalnight996
AppPublisherURL=https://github.com/EternalNight996/autokill-purge
AppSupportURL=https://github.com/EternalNight996/autokill-purge/issues
AppUpdatesURL=https://github.com/EternalNight996/autokill-purge/releases
DefaultDirName={localappdata}\Programs\autokill-purge
DefaultGroupName=梦神破甲
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=autokill-purge-{#AppVersion}-setup
SetupIconFile=..\assets\autokill-purge.ico
UninstallDisplayIcon={app}\autokill-purge.exe
UninstallDisplayName=梦神破甲 autokill-purge
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
LicenseFile=..\LICENSE

[Languages]
Name: "chinesesimplified"; MessagesFile: "lang\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Languages: chinesesimplified
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional tasks:"; Languages: english
Name: "autostart"; Description: "开机自动启动控制台（8792）"; GroupDescription: "附加任务："; Flags: unchecked; Languages: chinesesimplified
Name: "autostart"; Description: "Start the console on login (port 8792)"; GroupDescription: "Additional tasks:"; Flags: unchecked; Languages: english

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\assets\autokill-purge.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\梦神破甲"; Filename: "{app}\autokill-purge.exe"; IconFilename: "{app}\autokill-purge.ico"; Comment: "打开梦神破甲控制台"
Name: "{group}\卸载 梦神破甲"; Filename: "{uninstallexe}"
Name: "{autodesktop}\梦神破甲"; Filename: "{app}\autokill-purge.exe"; IconFilename: "{app}\autokill-purge.ico"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "autokill-purge"; ValueData: """{app}\autokill-purge.exe"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\autokill-purge.exe"; Description: "启动梦神破甲控制台"; Flags: nowait postinstall skipifsilent
Filename: "http://127.0.0.1:8792"; Description: "打开控制台页面"; Flags: shellexec nowait postinstall skipifsilent unchecked

[UninstallRun]
; 只结束 autokill-purge 起的 node（按命令行过滤），不碰别的 node 进程
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Get-CimInstance Win32_Process -Filter \""Name='node.exe'\"" | Where-Object {{ $_.CommandLine -match 'autokill-purge' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"""; Flags: runhidden; RunOnceId: "StopConsole"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
