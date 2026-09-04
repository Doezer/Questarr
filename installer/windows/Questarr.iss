#define MyAppName "Questarr"
#define MyAppPublisher "Doezer"
#define MyAppURL "https://github.com/Doezer/Questarr"
#define MyAppVersion GetEnv("QUESTARR_VERSION")
#define MySourceDir GetEnv("QUESTARR_SOURCE_DIR")
#define MyOutputDir GetEnv("QUESTARR_OUTPUT_DIR")
#define MyFilesInclude GetEnv("QUESTARR_FILES_INCLUDE")

#if MyAppVersion == ""
  #define MyAppVersion "0.0.0"
#endif

#if MyFilesInclude == ""
  #error QUESTARR_FILES_INCLUDE must point to the generated installer file list.
#endif

[Setup]
; Freshly generated for the Doezer/Questarr installer - do not reuse this
; GUID for any other Questarr distribution (e.g. a fork's own installer),
; since AppId is what Windows uses to recognize upgrades vs. a fresh install.
AppId={{8E661E0D-ECE5-43CF-9FF4-A4E8BC06690E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\Questarr
DefaultGroupName=Questarr
DisableProgramGroupPage=yes
OutputDir={#MyOutputDir}
OutputBaseFilename=QuestarrSetup-{#MyAppVersion}-windows-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\Questarr.Service.exe
CloseApplications=no

[Dirs]
; NOTE: {app}\data is deliberately NOT created here. It is created as an NTFS
; directory junction to {commonappdata}\Questarr\data in the [Run] section
; below, once this directory exists to link to. See the comment above the
; junction [Run] entry for why.
;
; Permissions below give Questarr.iss a non-inherited ACL instead of the
; default %ProgramData% ACL, which grants BUILTIN\Users Create Files/Write
; Data. The service reads every key out of config.env (which lives directly
; under {commonappdata}\Questarr) into the Node child process's environment
; and runs as LocalSystem, so if a standard user could write that file they
; could set e.g. NODE_OPTIONS=--require <payload> and get code execution at
; LocalSystem privilege on the next service start. Administrators/SYSTEM
; always get Full Control regardless of what's listed here; only the root
; and \data directories are restricted to admins/SYSTEM-only, since neither
; needs to be touched by a non-admin user. \logs keeps read access for
; standard users so the "Questarr Logs" Start Menu shortcut still works.
Name: "{commonappdata}\Questarr"; Permissions: admins-full system-full
Name: "{commonappdata}\Questarr\data"; Permissions: admins-full system-full
Name: "{commonappdata}\Questarr\logs"; Permissions: admins-full system-full users-readexec

[Files]
Source: "{#MySourceDir}\questarr-install-manifest.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MySourceDir}\questarr-install-manifest.json"; Flags: dontcopy
#include MyFilesInclude

[Icons]
; Points at the default port. A custom PORT set in config.env after install
; is not reflected here since Inno's static [Icons] section cannot read that
; file - see README.txt for how to reach Questarr on a non-default port.
Name: "{group}\Questarr (default port 5000)"; Filename: "http://localhost:5000"
Name: "{group}\Questarr Logs"; Filename: "{commonappdata}\Questarr\logs"
Name: "{group}\Uninstall Questarr"; Filename: "{uninstallexe}"

[Run]
; Questarr's own config-loader (server/config-loader.ts) resolves its
; optional config.yaml (SSL settings) relative to process.cwd() as
; "<cwd>/data/config.yaml", the same way the Docker image bind-mounts
; ./data to /app/data and points SQLITE_DB_PATH at /app/data/sqlite.db.
; The Windows service runs Node with {app} as its working directory (so
; package.json/migrations/the file-browser root all resolve exactly like
; `npm start` does), so linking {app}\data to the persistent
; %ProgramData%\Questarr\data directory makes that same cwd-relative lookup
; land in ProgramData instead of Program Files - which is what actually
; survives an uninstall/reinstall. `if not exist` makes this idempotent
; across upgrades/repairs, where the junction from a previous install is
; already in place.
Filename: "{cmd}"; Parameters: "/c if not exist ""{app}\data"" mklink /J ""{app}\data"" ""{commonappdata}\Questarr\data"""; Flags: runhidden waituntilterminated; StatusMsg: "Linking Questarr data directory..."
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Questarr"""; Flags: runhidden waituntilterminated; StatusMsg: "Refreshing Windows Firewall rule..."
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Questarr"" dir=in action=allow program=""{app}\bin\node.exe"" enable=yes"; Flags: runhidden waituntilterminated; StatusMsg: "Adding Windows Firewall rule..."
Filename: "{sys}\sc.exe"; Parameters: "create Questarr binPath= ""{app}\Questarr.Service.exe"" start= auto DisplayName= ""Questarr"""; Flags: runhidden waituntilterminated; StatusMsg: "Installing Questarr service..."
Filename: "{sys}\sc.exe"; Parameters: "config Questarr binPath= ""{app}\Questarr.Service.exe"" start= auto"; Flags: runhidden waituntilterminated; StatusMsg: "Updating Questarr service..."
Filename: "{sys}\sc.exe"; Parameters: "description Questarr ""Questarr video game management service"""; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "failure Questarr reset= 86400 actions= restart/60000/restart/60000/""""/60000"; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "start Questarr"; Flags: runhidden waituntilterminated; StatusMsg: "Starting Questarr service..."

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop Questarr"; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "delete Questarr"; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Questarr"""; Flags: runhidden waituntilterminated

[Code]
function PowerShellSingleQuote(Value: String): String;
var
  Escaped: String;
begin
  Escaped := Value;
  StringChangeEx(Escaped, '''', '''''', True);
  Result := '''' + Escaped + '''';
end;

var
  ChangedPayloadFiles: String;

function NormalizePayloadRelativePath(Value: String): String;
begin
  Result := Lowercase(Value);
  StringChangeEx(Result, '/', '\', True);
end;

function BuildChangedPayloadList(): Boolean;
var
  ScriptPath: String;
  OutputPath: String;
  ManifestPath: String;
  Script: String;
  ResultCode: Integer;
  ChangedRaw: AnsiString;
  InstallDir: String;
begin
  Result := False;
  ChangedPayloadFiles := '*';
  InstallDir := ExpandConstant('{app}');
  ScriptPath := ExpandConstant('{tmp}\questarr-changed-payload.ps1');
  OutputPath := ExpandConstant('{tmp}\questarr-changed-payload.txt');
  ExtractTemporaryFile('questarr-install-manifest.json');
  ManifestPath := ExpandConstant('{tmp}\questarr-install-manifest.json');

  Script :=
    '$ErrorActionPreference = ''Stop''' + #13#10 +
    '$manifestPath = ' + PowerShellSingleQuote(ManifestPath) + #13#10 +
    '$installDir = [System.IO.Path]::GetFullPath(' + PowerShellSingleQuote(InstallDir) + ')' + #13#10 +
    '$outputPath = ' + PowerShellSingleQuote(OutputPath) + #13#10 +
    '$oldManifestPath = Join-Path $installDir ''questarr-install-manifest.json''' + #13#10 +
    'function Write-AllPayloadChanged { Set-Content -LiteralPath $outputPath -Value ''*'' -Encoding ASCII }' + #13#10 +
    'function Normalize-QuestarrPath([string]$value) { $value.Replace(''/'', ''\'').ToLowerInvariant() }' + #13#10 +
    'if (-not (Test-Path -LiteralPath $oldManifestPath -PathType Leaf)) { Write-AllPayloadChanged; exit 0 }' + #13#10 +
    'try {' + #13#10 +
    '  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json' + #13#10 +
    '  $oldManifest = Get-Content -LiteralPath $oldManifestPath -Raw | ConvertFrom-Json' + #13#10 +
    '} catch {' + #13#10 +
    '  Write-AllPayloadChanged; exit 0' + #13#10 +
    '}' + #13#10 +
    '$newFiles = @($manifest.files)' + #13#10 +
    '$oldFiles = @{}' + #13#10 +
    'foreach ($entry in @($oldManifest.files)) {' + #13#10 +
    '  $relative = [string]$entry.path' + #13#10 +
    '  if ([string]::IsNullOrWhiteSpace($relative)) { continue }' + #13#10 +
    '  $oldFiles[(Normalize-QuestarrPath $relative)] = [pscustomobject]@{ Size = [int64]$entry.size; Sha256 = ([string]$entry.sha256).ToLowerInvariant() }' + #13#10 +
    '}' + #13#10 +
    '$changed = New-Object System.Collections.Generic.List[string]' + #13#10 +
    'foreach ($entry in $newFiles) {' + #13#10 +
    '  $relative = [string]$entry.path' + #13#10 +
    '  if ([string]::IsNullOrWhiteSpace($relative)) { continue }' + #13#10 +
    '  $normalizedPath = Normalize-QuestarrPath $relative' + #13#10 +
    '  if (-not $oldFiles.ContainsKey($normalizedPath)) { $changed.Add($relative); continue }' + #13#10 +
    '  $oldEntry = $oldFiles[$normalizedPath]' + #13#10 +
    '  if ($oldEntry.Size -ne [int64]$entry.size) { $changed.Add($relative); continue }' + #13#10 +
    '  if ($oldEntry.Sha256 -ne ([string]$entry.sha256).ToLowerInvariant()) { $changed.Add($relative); continue }' + #13#10 +
    '  $relativeForDisk = $relative.Replace(''/'', [System.IO.Path]::DirectorySeparatorChar)' + #13#10 +
    '  $targetPath = Join-Path $installDir $relativeForDisk' + #13#10 +
    '  if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) { $changed.Add($relative); continue }' + #13#10 +
    '}' + #13#10 +
    '$normalized = @($changed | ForEach-Object { $_.Replace(''/'', ''\'').ToLowerInvariant() })' + #13#10 +
    'if ($newFiles.Count -gt 0 -and $changed.Count -eq $newFiles.Count) {' + #13#10 +
    '  $payload = ''*''' + #13#10 +
    '} else {' + #13#10 +
    '  $payload = ''|'' + ($normalized -join ''|'') + ''|''' + #13#10 +
    '}' + #13#10 +
    'Set-Content -LiteralPath $outputPath -Value $payload -Encoding ASCII' + #13#10;

  Log('Building Questarr changed-file list before extraction.');
  if not SaveStringToFile(ScriptPath, Script, False) then
  begin
    Log('Could not write changed-file scan script. Installing all payload files.');
    Exit;
  end;

  if not Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File ' + AddQuotes(ScriptPath),
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) then
  begin
    Log('Could not run changed-file scan script. Installing all payload files.');
    Exit;
  end;

  if ResultCode <> 0 then
  begin
    Log('Changed-file scan failed with exit code ' + IntToStr(ResultCode) + '. Installing all payload files.');
    Exit;
  end;

  if not LoadStringFromFile(OutputPath, ChangedRaw) then
  begin
    Log('Could not read changed-file scan output. Installing all payload files.');
    Exit;
  end;

  ChangedPayloadFiles := ChangedRaw;
  ChangedPayloadFiles := Trim(ChangedPayloadFiles);
  if ChangedPayloadFiles = '' then
  begin
    ChangedPayloadFiles := '*';
    Log('Changed-file scan output was empty. Installing all payload files.');
    Exit;
  end;

  Result := True;
end;

function ShouldInstallPayloadFile(RelativePath: String): Boolean;
var
  Needle: String;
begin
  if ChangedPayloadFiles = '*' then
  begin
    Result := True;
    Exit;
  end;

  Needle := '|' + NormalizePayloadRelativePath(RelativePath) + '|';
  Result := Pos(Needle, ChangedPayloadFiles) > 0;
  if not Result then
  begin
    Log('Skipping unchanged Questarr payload file: ' + RelativePath);
  end;
end;

function StopInstalledQuestarr(Context: String): String;
var
  ScriptPath: String;
  Script: String;
  ResultCode: Integer;
  InstallDir: String;
  DeleteService: String;
begin
  Result := '';
  InstallDir := ExpandConstant('{app}');
  DeleteService := '$false';
  if Context = 'uninstall' then
  begin
    DeleteService := '$true';
  end;
  ScriptPath := ExpandConstant('{tmp}\questarr-stop-' + Context + '.ps1');
  Script :=
    '$ErrorActionPreference = ''Continue''' + #13#10 +
    '$serviceName = ''Questarr''' + #13#10 +
    '$deleteService = ' + DeleteService + #13#10 +
    '$installDir = [System.IO.Path]::GetFullPath(' + PowerShellSingleQuote(InstallDir) + ')' + #13#10 +
    'if (-not $installDir.EndsWith([string][System.IO.Path]::DirectorySeparatorChar)) { $installDir += [System.IO.Path]::DirectorySeparatorChar }' + #13#10 +
    'function Get-QuestarrProcess {' + #13#10 +
    '  Get-CimInstance Win32_Process | Where-Object {' + #13#10 +
    '    $exeMatches = $false' + #13#10 +
    '    $cmdMatches = $false' + #13#10 +
    '    if ($_.ExecutablePath) {' + #13#10 +
    '      try { $exeMatches = [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($installDir, [System.StringComparison]::OrdinalIgnoreCase) } catch { }' + #13#10 +
    '    }' + #13#10 +
    '    if ($_.CommandLine) {' + #13#10 +
    '      $cmdMatches = $_.CommandLine.IndexOf($installDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0' + #13#10 +
    '    }' + #13#10 +
    '    ($exeMatches -or $cmdMatches) -and $_.ProcessId -ne $PID' + #13#10 +
    '  }' + #13#10 +
    '}' + #13#10 +
    'function Stop-QuestarrProcess {' + #13#10 +
    '  Get-QuestarrProcess | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }' + #13#10 +
    '}' + #13#10 +
    '$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue' + #13#10 +
    'if ($service) {' + #13#10 +
    '  if ($service.Status -ne ''Stopped'') {' + #13#10 +
    '    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue' + #13#10 +
    '    & sc.exe stop $serviceName | Out-Null' + #13#10 +
    '    try { $service.WaitForStatus(''Stopped'', ''00:00:30'') } catch { }' + #13#10 +
    '  }' + #13#10 +
    '  if ($deleteService) { & sc.exe delete $serviceName | Out-Null }' + #13#10 +
    '}' + #13#10 +
    'Stop-QuestarrProcess' + #13#10 +
    'for ($attempt = 1; $attempt -le 30; $attempt++) {' + #13#10 +
    '  $remaining = @(Get-QuestarrProcess)' + #13#10 +
    '  if ($remaining.Count -eq 0) { break }' + #13#10 +
    '  Stop-QuestarrProcess' + #13#10 +
    '  Start-Sleep -Seconds 1' + #13#10 +
    '}' + #13#10 +
    '$remaining = @(Get-QuestarrProcess)' + #13#10 +
    'if ($remaining.Count -gt 0) {' + #13#10 +
    '  Write-Error (''Questarr processes are still running: '' + (($remaining | ForEach-Object { $_.ProcessId }) -join '', ''))' + #13#10 +
    '  exit 20' + #13#10 +
    '}' + #13#10 +
    '$lockProbeFiles = @(''bin\node.exe'', ''node_modules\better-sqlite3\build\Release\better_sqlite3.node'', ''node_modules\bufferutil\prebuilds\win32-x64\bufferutil.node'')' + #13#10 +
    'for ($attempt = 1; $attempt -le 30; $attempt++) {' + #13#10 +
    '  $locked = @()' + #13#10 +
    '  foreach ($relativePath in $lockProbeFiles) {' + #13#10 +
    '    $path = Join-Path $installDir $relativePath' + #13#10 +
    '    if (Test-Path -LiteralPath $path) {' + #13#10 +
    '      $stream = $null' + #13#10 +
    '      try {' + #13#10 +
    '        $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)' + #13#10 +
    '      } catch {' + #13#10 +
    '        $locked += $path' + #13#10 +
    '      } finally {' + #13#10 +
    '        if ($stream) { $stream.Dispose() }' + #13#10 +
    '      }' + #13#10 +
    '    }' + #13#10 +
    '  }' + #13#10 +
    '  if ($locked.Count -eq 0) { exit 0 }' + #13#10 +
    '  Stop-QuestarrProcess' + #13#10 +
    '  Start-Sleep -Seconds 1' + #13#10 +
    '}' + #13#10 +
    'Write-Error (''Questarr files are still locked: '' + ($locked -join '', ''))' + #13#10 +
    'exit 21' + #13#10;

  Log('Preparing Questarr ' + Context + ' by stopping the service and install-directory processes.');
  if not SaveStringToFile(ScriptPath, Script, False) then
  begin
    Result := 'Questarr could not prepare the service shutdown script.';
    Exit;
  end;

  if not Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File ' + AddQuotes(ScriptPath),
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) then
  begin
    Result := 'Questarr could not run the service shutdown script.';
    Exit;
  end;

  if ResultCode <> 0 then
  begin
    Result := 'Questarr could not stop the existing service. Close Questarr processes and retry setup.';
    Exit;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  if not BuildChangedPayloadList() then
  begin
    ChangedPayloadFiles := '*';
  end;
  Result := StopInstalledQuestarr('upgrade');
end;

function RemoveDataJunction(): Boolean;
var
  ScriptPath: String;
  Script: String;
  ResultCode: Integer;
begin
  // {app}\data is an NTFS junction into %ProgramData%\Questarr\data (see the
  // [Run] section above). Removing a junction with `rmdir` (no /s) unlinks
  // only the reparse point itself - it does not touch, let alone delete, the
  // real files it points at in ProgramData, which is exactly what we want:
  // uninstalling Questarr must never delete the user's database or config.
  Result := True;
  ScriptPath := ExpandConstant('{tmp}\questarr-remove-data-junction.ps1');
  Script :=
    '$ErrorActionPreference = ''Continue''' + #13#10 +
    '$dataLink = ' + PowerShellSingleQuote(ExpandConstant('{app}\data')) + #13#10 +
    'if (Test-Path -LiteralPath $dataLink) {' + #13#10 +
    '  $item = Get-Item -LiteralPath $dataLink -Force' + #13#10 +
    '  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {' + #13#10 +
    '    cmd /c rmdir "$dataLink"' + #13#10 +
    '  }' + #13#10 +
    '}' + #13#10 +
    'exit 0' + #13#10;

  if not SaveStringToFile(ScriptPath, Script, False) then
  begin
    Log('Could not write data-junction cleanup script; leaving {app}\data in place.');
    Exit;
  end;

  if not Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File ' + AddQuotes(ScriptPath),
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) then
  begin
    Log('Could not run data-junction cleanup script; leaving {app}\data in place.');
  end;
end;

function InitializeUninstall(): Boolean;
var
  StopError: String;
begin
  StopError := StopInstalledQuestarr('uninstall');
  if StopError <> '' then
  begin
    Result := MsgBox(StopError + #13#10#13#10 + 'Continue uninstall anyway?', mbConfirmation, MB_YESNO) = IDYES;
  end
  else
  begin
    Result := True;
  end;

  if Result then
  begin
    // Only unlink the junction, never the ProgramData data it points to -
    // %ProgramData%\Questarr itself is left untouched so a reinstall picks
    // the existing database and config back up.
    RemoveDataJunction();
  end;
end;
