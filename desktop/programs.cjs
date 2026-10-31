const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { createHash } = require('node:crypto');
const exec = promisify(execFile);
// Read only. Never execute discovered files or read shortcut/process arguments.
const discoveryScript = String.raw`
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$items=New-Object 'System.Collections.Generic.List[object]'
$roots=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
[IO.DriveInfo]::GetDrives()|Where-Object {$_.DriveType -eq 'Fixed'}|ForEach-Object {[void]$roots.Add($_.RootDirectory.FullName)}
function Local-Path([string]$value) {
  if(!$value){return $null}
  $value=[Environment]::ExpandEnvironmentVariables($value.Trim().Trim('"'))
  if($value -notmatch '^[a-zA-Z]:\\' -or !$roots.Contains([IO.Path]::GetPathRoot($value))){return $null}
  return $value
}
function Add-App([string]$file,[string]$name,[string]$source,[bool]$running=$false) {
  if($items.Count -ge 6000){return}
  $file=Local-Path $file
  if(!$file -or [IO.Path]::GetExtension($file) -ine '.exe'){return}
  $exe=[IO.Path]::GetFileName($file)
  if($exe -match '^(unins\d*|uninstall|setup|updater?|crashpad_handler|svchost|conhost|dllhost|RuntimeBroker|WerFault)\.exe$'){return}
  if($source -eq 'running' -and $file.StartsWith($env:windir+'\',[StringComparison]::OrdinalIgnoreCase) -and $exe -notmatch '^(notepad|mspaint|calc|explorer|cmd|powershell|pwsh|WindowsTerminal)\.exe$'){return}
  if(![IO.File]::Exists($file)){return}
  if(!$name){$name=[IO.Path]::GetFileNameWithoutExtension($file)}
  $items.Add([pscustomobject]@{path=$file;name=$name;source=$source;running=$running})
}
Get-Process|ForEach-Object {Add-App $_.Path $_.ProcessName 'running' $true}
foreach($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths','HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths')){
  Get-ChildItem -LiteralPath $key|ForEach-Object {$v=Get-ItemProperty -LiteralPath $_.PSPath;Add-App $v.'(default)' '' 'registry'}
}
foreach($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')){
  Get-ChildItem -LiteralPath $key|ForEach-Object {
    $v=Get-ItemProperty -LiteralPath $_.PSPath
    if($v.SystemComponent -eq 1 -or !$v.DisplayName){return}
    $icon=[string]$v.DisplayIcon
    if($icon -match '^"([^"]+\.exe)"(?:,\s*-?\d+)?$'){Add-App $matches[1] $v.DisplayName 'registry'}
    elseif($icon -match '^(.+?\.exe)(?:,\s*-?\d+)?$'){Add-App $matches[1] $v.DisplayName 'registry'}
    $location=Local-Path $v.InstallLocation
    if($location){Get-ChildItem -LiteralPath $location -Filter '*.exe' -File|Select-Object -First 40|ForEach-Object {Add-App $_.FullName $v.DisplayName 'registry'}}
  }
}
$shell=New-Object -ComObject WScript.Shell
foreach($menu in @([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'))){
  Get-ChildItem -LiteralPath $menu -Filter '*.lnk' -File -Recurse|Select-Object -First 2000|ForEach-Object {
    $shortcut=$shell.CreateShortcut($_.FullName)
    Add-App $shortcut.TargetPath $_.BaseName 'start-menu'
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut)
  }
}
if($shell){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}
@{items=@($items.ToArray());limited=($items.Count -ge 6000)}|ConvertTo-Json -Depth 4 -Compress
`;
function normalizePrograms(records, limited = false) {
  if (!Array.isArray(records)) throw new Error('Invalid program list');
  const groups = new Map(), priority = { running: 1, registry: 2, 'start-menu': 3 };
  for (const row of records.slice(0, 6000)) {
    if (!row || typeof row.path !== 'string' || row.path.length > 2048 || !/^[a-z]:\\/i.test(row.path) || /[\x00-\x1f"<>|?*]/.test(row.path)) continue;
    const file = path.win32.normalize(row.path), process = path.win32.basename(file);
    if (!/^[^\\/:*?"<>|\r\n]+\.exe$/i.test(process)) continue;
    const key = process.toLowerCase(), rank = priority[row.source] || 0;
    const name = typeof row.name === 'string' ? row.name.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 120) : process;
    let group = groups.get(key);
    if (!group) { group = { id: createHash('sha256').update(key).digest('hex').slice(0, 16), process, name: name || process, running: false, paths: [], sources: [], rank: 0 }; groups.set(key, group); }
    group.running ||= row.running === true;
    if (rank > group.rank && name) { group.name = name; group.rank = rank; }
    if (!group.paths.some(p => p.toLowerCase() === file.toLowerCase()) && group.paths.length < 32) group.paths.push(file);
    if (priority[row.source] && !group.sources.includes(row.source)) group.sources.push(row.source);
  }
  const programs = [...groups.values()].sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name, 'zh-CN') || a.process.localeCompare(b.process));
  return { programs: programs.slice(0, 2000).map(({ rank, ...app }) => app), partial: limited || records.length > 6000 || programs.length > 2000 };
}
function createProgramScanner({ run = async () => {
  if (process.platform !== 'win32') throw new Error('Windows only');
  return (await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(discoveryScript, 'utf16le').toString('base64')], { windowsHide: true, timeout: 25000, maxBuffer: 8 * 1024 * 1024 })).stdout;
}, now = Date.now } = {}) {
  let cached, inFlight;
  return async function scan(force = false) {
    if (inFlight) return inFlight;
    if (!force && cached && now() - cached.scannedAt < 30000) return cached;
    inFlight = (async () => {
      try {
        const raw = JSON.parse((await run()).replace(/^\uFEFF/, ''));
        cached = { ...normalizePrograms(raw.items, raw.limited === true), scannedAt: now() };
        return cached;
      } catch { throw new Error('无法识别系统程序，请重试或手动添加'); }
      finally { inFlight = null; }
    })();
    return inFlight;
  };
}
module.exports = { discoveryScript, normalizePrograms, createProgramScanner, scanPrograms: createProgramScanner() };
