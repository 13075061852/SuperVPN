const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
async function ps(script) {
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop';" + script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 });
  return stdout.trim();
}
const notify = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class InternetRefresh{[DllImport("wininet.dll")]public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l);}';[InternetRefresh]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)|Out-Null;[InternetRefresh]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)|Out-Null;`;
const environmentNotify = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class EnvironmentRefresh{[DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,string l,uint f,uint t,out UIntPtr r);}';$result=[UIntPtr]::Zero;[EnvironmentRefresh]::SendMessageTimeout([IntPtr]0xffff,0x001a,[UIntPtr]::Zero,'Environment',2,3000,[ref]$result)|Out-Null;`;
exports.readUserProxyEnvironment = async () => JSON.parse(await ps(`$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment');$out=@{};try{foreach($name in @('HTTP_PROXY','HTTPS_PROXY')){$exists=$null -ne $key -and $key.GetValueNames() -contains $name;if($exists){$kind=$key.GetValueKind($name).ToString();if($kind -notin @('String','ExpandString')){throw 'Unsupported environment value type'};$out[$name]=@{exists=$true;value=$key.GetValue($name,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames);kind=$kind}}else{$out[$name]=@{exists=$false}}};$out|ConvertTo-Json -Depth 4 -Compress}finally{if($key){$key.Dispose()}}`));
exports.writeUserProxyEnvironment = async values => {
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY']) {
    const item = values?.[name];
    if (!item || typeof item.exists !== 'boolean' || (item.exists && (typeof item.value !== 'string' || !['String', 'ExpandString'].includes(item.kind)))) throw new Error('无效的环境变量快照');
  }
  const encoded = Buffer.from(JSON.stringify(values)).toString('base64');
  await ps(`$values=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))|ConvertFrom-Json;$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment');try{foreach($name in @('HTTP_PROXY','HTTPS_PROXY')){$item=$values.$name;if($item.exists){$kind=[Microsoft.Win32.RegistryValueKind]([Enum]::Parse([Microsoft.Win32.RegistryValueKind],$item.kind));$key.SetValue($name,[string]$item.value,$kind)}else{$key.DeleteValue($name,$false)}};$key.Flush()}finally{$key.Dispose()};${environmentNotify}`);
};
exports.isAdmin = async () => (await ps('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)')) === 'True';
exports.readProxy = async () => JSON.parse(await ps(`$p=Get-ItemProperty '${KEY}';@{ProxyEnable=$p.ProxyEnable;ProxyServer=$p.ProxyServer;ProxyOverride=$p.ProxyOverride;AutoConfigURL=$p.AutoConfigURL}|ConvertTo-Json -Compress`));
exports.setProxy = async (values) => {
  const data = Buffer.from(JSON.stringify(values)).toString('base64');
  await ps(`$v=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'))|ConvertFrom-Json;foreach($p in $v.PSObject.Properties){if($null -eq $p.Value){Remove-ItemProperty -Path '${KEY}' -Name $p.Name -ErrorAction SilentlyContinue}else{$t=if($p.Name -eq 'ProxyEnable'){'DWord'}else{'String'};New-ItemProperty -Path '${KEY}' -Name $p.Name -Value $p.Value -PropertyType $t -Force|Out-Null}};${notify}`);
};
