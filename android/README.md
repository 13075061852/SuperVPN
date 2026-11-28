# SuperVPN Android

独立的安卓客户端，与 `electron/` 下的 Windows 端互不影响。共享同一套节点链接与订阅格式，但不读取、不修改电脑端的配置。

- 语言/UI：Kotlin + Jetpack Compose（紫色主题、12px 间距、10px 圆角、无 emoji 图标）
- 内核：sing-box v1.12.14 通过官方 `libbox`（gomobile 绑定）在进程内运行
- 接管方式：Android `VpnService`（TUN 全局接管），前台服务常驻通知
- 包名：`app.supervpn.android`，minSdk 26 / targetSdk 35，ABI：arm64-v8a、armeabi-v7a

## 功能现状

已实现（v0.2.0）：

- 底部五标签专业界面：仪表盘 / 线路选择 / 订阅管理 / 分流控制 / 设置与日志（紫色主题、10dp 圆角、12dp 间距、纯矢量图标、支持深浅色模式）
- 仪表盘：连接状态与计时器、一键连接/断开与配置变更重连提示、出站模式（规则 / 全局 / 直连，已连接时通过 Clash API 即时切换）、实时上传/下载速度与 30 秒折线图、出口 IP 与内网 IP 检测
- 订阅导入与管理：HTTPS 订阅（Base64、明文链接列表、Clash YAML），自动解析 `Subscription-Userinfo` 流量配额与到期时间，支持单订阅更新、全部更新、重命名与删除
- 节点管理：支持单/多行链接导入与剪贴板粘贴（VLESS / Trojan / Shadowsocks / AnyTLS / Hysteria2 / SOCKS5 / HTTP/HTTPS）、按来源分组、关键词搜索、真实 TCP 并发测速、按延迟排序、隐藏超时节点、节点详情查看与重命名
- 分流控制：网站分流规则（内置与桌面端同步的国内直连域名预设，支持新增/切换动作/启停/删除并同步直连 DNS）、按应用分流（全部代理 / 绕过选中应用 / 仅代理选中应用）
- 安全与日志：Android Keystore（AES-256-GCM）加密存储、局域网直连、IPv6 隧道开关、不安全证书节点显式开关、带时间戳和级别筛选的运行日志与一键复制

暂未实现（后续可加）：

- VMess、ECH、自定义 sing-box JSON
- 自动更新

## 构建

需要：JDK 17、Android SDK（platform 35、build-tools 35.0.0）、Android NDK 28.0.13004108、Go 1.23+、Gradle 8.11。

1. 生成内核 AAR（`libbox.aar` 不提交仓库，约 23 MB）：

```powershell
$env:ANDROID_HOME = '<sdk>'
$env:ANDROID_NDK_HOME = '<sdk>\ndk\28.0.13004108'
$env:JAVA_HOME = '<jdk17>'
git clone --depth 1 --branch v1.12.14 https://github.com/SagerNet/sing-box.git sb
cd sb
go install github.com/sagernet/gomobile/cmd/gomobile@latest
go install github.com/sagernet/gomobile/cmd/gobind@latest
go run github.com/sagernet/gomobile/cmd/gomobile init
gomobile bind -target=android/arm64,android/arm -androidapi 26 -javapkg=io.nekohasekai -libname=box `
  -trimpath -buildvcs=false -ldflags "-X github.com/sagernet/sing-box/constant.Version=v1.12.14 -s -w -buildid= -checklinkname=0" `
  -tags with_gvisor,with_quic,with_wireguard,with_utls,with_clash_api,with_conntrack ./experimental/libbox
copy libbox.aar <repo>\android\app\libs\libbox.aar
```

2. 配置签名（`keystore.properties` 与 `.jks` 都已被 `.gitignore` 忽略，请单独备份；丢失后无法覆盖安装升级）：

```
storeFile=keystore/supervpn-release.jks
storePassword=...
keyAlias=supervpn
keyPassword=...
```

生成密钥：

```powershell
keytool -genkeypair -v -keystore android/keystore/supervpn-release.jks -storetype PKCS12 `
  -alias supervpn -keyalg RSA -keysize 2048 -validity 10950
```

3. 构建与验证：

```powershell
cd android
gradle :app:testReleaseUnitTest          # 链接解析、订阅解析、配置生成的单元测试
gradle :app:assembleRelease              # 输出 app/build/outputs/apk/release/app-release.apk
```

## 结构

```
app/src/main/java/app/supervpn/android/
  data/     节点与订阅模型、链接解析、订阅下载、sing-box 配置生成、加密存储、UI 状态
  core/     libbox 平台接口实现（AndroidPlatform）与迭代器
  service/  SuperVpnService（VpnService + 前台通知 + 内核生命周期）
  ui/       主题
  MainActivity.kt  Compose 界面
```

## 已知限制与注意事项

- 链接加密与桌面端一样依赖内核：`libbox` 以 GPL-3.0-or-later 链接进本应用，因此该 APK 的分发需遵守 GPL（sing-box 许可证随 Releases 一并提供）。
- 未验证的平台行为：当前构建环境没有安卓真机/模拟器，只做了编译、签名校验与单元测试；连接、分流、续航等需要真机验收。
- 内核异常退出（如节点被服务端拒绝）后，界面状态可能仍显示已连接，需手动断开重连；内核退出监听待补。
- 仅有 arm64 / arm32，未包含 x86（模拟器）。
- 安卓版本不提供系统代理模式，也不做桌面的程序分流（`.exe` 规则在此无意义）。
