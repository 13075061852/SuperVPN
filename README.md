# SuperVPN

简洁的 Windows 10/11 x64 系统代理客户端。Electron + React + sing-box 1.12.14，浅紫色界面，无需开发服务器即可运行安装版。

[下载安装包](https://github.com/13075061852/SuperVPN/releases/latest) · [发布记录](https://github.com/13075061852/SuperVPN/releases)

## 安装与使用

1. 从 Releases 下载 `SuperVPN-Setup-版本号.exe`，按中文安装向导选择安装位置。
2. 在「节点导入」添加 HTTPS 订阅或独立节点链接。
3. 在「线路选择」选择节点，在仪表盘连接。

安装版和开发版的配置目录相互独立。首次从开发版改用安装版时，需要在安装版导入节点；安装版后续升级保留原有配置，不覆盖节点、订阅和偏好。关闭窗口默认驻留托盘；正常退出请使用托盘菜单。

安装包暂未代码签名，Windows SmartScreen 可能提示未知发布者，请只从本仓库 Releases 下载。

## 自动更新

从 **0.6.0 安装版**开始支持：

- 启动约 15 秒后检查更新，运行期间每 4 小时再检查，也可在设置中手动检查。
- 从本仓库的公开 GitHub Releases 获取版本，发现新稳定版本后自动下载。
- 下载完成后显示「安装更新 / 稍后」，不会自动退出，普通退出也不会偷偷安装。
- 只有点击「安装更新」后才重新核对安装文件 SHA-512、停止测试、恢复系统代理并关闭客户端，进入可见的中文安装向导，不使用静默安装。
- 校验失败不执行安装；代理恢复失败不继续退出安装。已有节点和设置保留。

旧的 0.5.x 或更早版本没有自动更新功能，首次需手动安装 0.6.0。开发模式不发起自动更新。更新源中不存放订阅或节点配置，客户端不包含 GitHub Token。

### 后续发布

更新代码后，**必须递增 `package.json` 和 `package-lock.json` 的版本号**再推送 `main`：

```powershell
npm version patch --no-git-tag-version
npm test
git add <本次修改的文件>
git commit -m "Release next version"
git push origin main
```

GitHub Actions 会检查该版本是否已经发布。新版本通过测试、打包和完整性验证后，自动创建 Release，上传安装包、`latest.yml`、`.blockmap` 及对应内核源码。客户端随后能检测并下载。只改代码而不升级版本，或者构建失败，不会发布更新；已发布版本不覆盖。

## 功能

- 独立订阅与节点来源；不同账号不会按名称或服务器合并。查看来源不切换当前连接。
- 规则 / 全局 / 直连模式可在连接期间切换，对新连接生效，不重启当前内核。
- 当前界面仅提供系统代理。它只影响遵循 Windows 代理设置的应用，不能强制接管所有程序，也不是全系统断网保护。“全局”指进入本地代理的流量全走代理。
- 分流控制只读识别运行程序、开始菜单和已注册应用，支持搜索、运行中 / 已配置筛选。相同 exe 名称共用规则；修改须先断开，下次连接生效。全局或直连模式不应用程序规则。
- 实时网速、累计流量、真实出口 IP / 地区和内网 IP。不编造流量、IP、延迟或套餐额度。
- 订阅用量优先取服务商的 `subscription-userinfo`；缺失总额度就显示未知，不从套餐名称猜测。
- 启动后自动连接上次选择的节点，可关闭；每个窗口只尝试一次，刷新或手动断开后不循环重连。
- 关闭到托盘、开机自启、窗口置顶。默认 860 × 700，最小 800 × 640，最大 1000 × 900；小屏以显示器可用区域为限。

### 协议与订阅

支持 HTTP / HTTPS、SOCKS5、VLESS（TCP / WS / gRPC / HTTPUpgrade、TLS / Reality）、Trojan、Shadowsocks（不含插件）、AnyTLS、Hysteria2。

HTTPS 订阅支持明文或 Base64 链接列表，上限 2 MB / 2000 条。当前不支持 Clash YAML、sing-box JSON、VMess、自定义 ECH DNS 扩展。不兼容记录不参与连接。更新同一订阅替换该来源节点，不跨来源混合。

### 实测与测速

线路延迟：独立临时 sing-box，默认 32 路并发，先预热再测第二次验证证书的 HTTPS HEAD 请求。失败保留实际错误，不填零，不人为减去握手耗时。只测当前来源，不遍历其他订阅。

仪表盘测速：延迟 → 预热 → 4 路下载约 10 秒 → 4 路上传约 10 秒。每约 250ms 显示最近约 1 秒的当前速率，阶段结束后显示全程平均值。上传最终量须经服务端确认，未完成的传输不会伪报完整成功；说明放在悬停提示里。固定使用 `speed.cloudflare.com`，实际消耗订阅流量，每阶段另有 2 GiB 防失控上限。

这些测试使用独立端口和临时内核，不切换系统代理、不重启当前连接。目标 HTTPS 证书始终严格验证，支持停止，临时明文配置结束后删除。

## 安全与限制

- 节点密码、订阅 Token 和终端环境原值通过 Electron `safeStorage` / Windows DPAPI 加密保存，不放入前端订阅详情、源码或更新元数据。
- 按节点链接显式的 `insecure=1` / `allowInsecure=1` / `true` 参数处理代理证书；没有标记则严格验证。跳过代理身份校验有中间人风险，不影响目标网站 HTTPS 的严格验证，不设置全局 `NODE_TLS_REJECT_UNAUTHORIZED=0`。
- 本地入站和控制接口仅监听回环地址，控制接口有随机认证。临时内核配置含凭据，请勿分享用户配置目录。
- 正常退出恢复此前的系统代理；异常退出在下次启动尝试恢复。强杀进程不能保证即时清理，请检查 Windows 手动代理和残留内核。
- 日志可能包含访问域名和本地程序路径；不要公开上传个人日志、订阅地址或配置文件。
- 不提供系统服务、订阅定时刷新或断网保护。进程分流及开机自启仍需结合目标 Windows 环境验收。

### 终端代理

设置开关仅更改当前用户 `HTTP_PROXY` / `HTTPS_PROXY`，不改机器级变量、`ALL_PROXY` 或 `NO_PROXY`。先加密备份原值、存在性和注册表类型，再写入；关闭时精确恢复。外部程序改动过的值不会静默覆盖。

重启终端后生效，不能修改已打开终端的环境。退出或断开不会自动删除持久环境变量；不再使用时通过开关恢复。

## 本地开发与构建

Windows、Node.js 22+、npm：

```powershell
npm install
npm run core:download   # 官方内核，固定 SHA-256 校验
npm run icons:build     # 原生透明 ICO、托盘图标
npm run desktop        # 独立开发配置，不改变安装版数据
npm test
npm run dist           # 构建中文 NSIS 安装向导，不自动发布
node scripts/verify-release.mjs
```

若 npm 阻止 Electron 安装脚本，先检查并批准该依赖，再运行 `node node_modules/electron/install.js`。前端保存即热更新，后台更新需用户主动正常退出再启动，绝不为了开发更新自动停止承载网络的代理。

`npm run dev` 是无网络接管权限的浏览器预览，不持久化凭据、不下载订阅。`npm run installer:assets` 可重建安装向导的品牌侧栏和页眉。

## 第三方许可

- [sing-box v1.12.14](https://github.com/SagerNet/sing-box/tree/v1.12.14)：GPL-3.0-or-later，使用未修改的官方二进制并作为独立进程运行。安装目录内附原始许可证及对应源码说明；Releases 同时提供对应版本源码归档。
- Electron / Chromium、React、Vite、electron-updater：参见相应项目及随附许可证。
- Lucide：ISC；国旗 `flag-icons`：MIT，声明位于应用 `licenses` 目录。
