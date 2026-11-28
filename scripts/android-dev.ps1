param(
    [switch]$OpenStudio,
    [switch]$StartEmulator,
    [switch]$InstallApk,
    [switch]$Logcat
)

$root = "C:\Users\32911\android-build"
$env:JAVA_HOME = "$root\jdk"
$env:ANDROID_HOME = "$root\sdk"
$env:ANDROID_SDK_ROOT = "$root\sdk"

$studio = "$root\android-studio\bin\studio64.exe"
$emulator = "$root\sdk\emulator\emulator.exe"
$adb = "$root\sdk\platform-tools\adb.exe"
$androidProject = Join-Path $PSScriptRoot "..\android"
$apkDir = Join-Path $PSScriptRoot "..\output\android"

if (-not ($OpenStudio -or $StartEmulator -or $InstallApk -or $Logcat)) {
    Write-Host "SuperVPN Android 电脑端测试环境脚本"
    Write-Host "  -OpenStudio     用 Android Studio 打开 android/ 工程"
    Write-Host "  -StartEmulator  启动 SuperVPN_Pixel_API35 模拟器"
    Write-Host "  -InstallApk     安装 output/android/ 中最新 APK 到已连接设备或模拟器"
    Write-Host "  -Logcat         过滤并查看 SuperVPN 实时运行与崩溃日志"
    exit 0
}

if ($OpenStudio) {
    Start-Process -FilePath $studio -ArgumentList "`"$androidProject`""
}

if ($StartEmulator) {
    Start-Process -FilePath $emulator -ArgumentList "-avd", "SuperVPN_Pixel_API35", "-no-audio", "-gpu", "auto"
}

if ($InstallApk) {
    $apk = Get-ChildItem -Path $apkDir -Filter "*.apk" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $apk) {
        Write-Error "未在 $apkDir 找到 APK 文件"
        exit 1
    }
    Write-Host "正在安装 $($apk.Name)..."
    & $adb install -r $apk.FullName
}

if ($Logcat) {
    Write-Host "正在监听 SuperVPN / AndroidRuntime / libbox 日志（按 Ctrl+C 停止）..."
    & $adb logcat -v time AndroidRuntime:E GoLog:* SuperVPNStore:* *:S
}
