# WorkBuddy 一键接入

适用版本：0.1.7 预览版。验收证据见 [M1 交付记录](M1-DELIVERY.md)。Windows 按本轮决定提供安装包，实机验证后置；语义分类继续暂缓。

## 操作

1. 安装并登录 WorkBuddy，保留原订阅和模型选择。
2. 打开 AI Privacy Gateway，在「保护」页点击「一键开启保护」。先保存 WorkBuddy 中正在进行的任务，接入会正常退出并重新打开 WorkBuddy。
3. 首次安装需要完成系统证书授权。已有同一证书的有效信任时，不重复授权。
4. 状态显示「已配置 · 等待请求」后，在 WorkBuddy 新建一条文本任务。
5. 发送完成后回到网关。状态变为「已验证」时，表示本次接入后已有请求通过正文检查，且原官方服务返回成功。
6. 查看「记录」中的替换内容、命中规则和正文校验。模型回复内容不能单独作为是否过滤的依据。

安装包见 [GitHub Release](https://github.com/yushxzh/ai-privacy-gateway/releases/tag/v0.1.7)。macOS Apple Silicon 选择 `mac-arm64.dmg`，Intel 选择 `mac-x64.dmg`，打开后将应用拖入「应用程序」；另提供 ZIP。Windows x64 选择 `win-x64.exe`，安装到当前用户。完整文件名以 `AI-Privacy-Gateway-0.1.7-` 开头；使用同页 `SHA256SUMS.txt` 核对下载文件。完整包无需另装 Node.js 或 Python。

此预览版没有正式签名、公证或自动更新，系统可能要求确认来源。安装包构建与实机验收分别记录。

```text
请写一句会议提醒，联系邮箱 oneclick@example.com。只回复文字，不调用工具、不访问网站、不读写文件。
```

此消息仅含合成联系方式，但会使用 WorkBuddy 现有账号额度。规则的默认处理动作是替换，可以在「规则」中改为阻断、关闭，或添加自定义规则。

## 停止与退出

「停止并恢复」会先正常关闭 WorkBuddy，恢复接入前的代理设置，再重新打开原来正在运行的 WorkBuddy。恢复成功后才停止本地代理。正常退出网关、关闭网关窗口、在「设置」停止网关，也会先执行恢复。

接入期间修改的其他 WorkBuddy 设置会保留。如果用户已换成另一代理，恢复时保留后来选择的代理，不覆盖它。旧版本手动填入本地代理且没有备份的连接，接管后默认恢复为「直接连接」。

遇到 WorkBuddy 未能退出或重启失败时，网关显示错误并保留恢复资料；请先正常退出 WorkBuddy，然后点击「停止并恢复」。不会强制结束未保存的工作。

强制结束网关或系统崩溃后，WorkBuddy 保持指向本地代理，模型请求保持阻断。TLS 子进程会在检查入口连续失联后退出。重新打开网关会尝试恢复同一端口，仍需新请求重新验证；不自动直连，也不自动重启网关。

## 移除接入、证书与卸载

1. 保存 WorkBuddy 任务，在网关「设置 → 接入与证书」点击「移除接入和证书」，核对说明后确认。
2. 完成系统要求的证书撤销授权。应用恢复原代理、停止代理，按公钥指纹撤销本产品信任并删除 CA 私钥；成功后重开原来运行的 WorkBuddy。
3. 如曾启用 WorkBuddy 自定义 API，在对应模型的接入列表逐项「恢复直连」。证书移除按钮只管理原生接入。
4. 正常退出网关。macOS 可删除应用；Windows 使用系统卸载入口，卸载程序会再次检查并恢复所有受管理模型地址和原生接入。

撤销取消或失败时，保留私钥和撤销身份供重试；Windows 清理失败会保留应用。更新安装不撤销证书。规则配置保留，再次开启会生成新的本机 CA 并重新授权。不要在系统信任尚未撤销前手工删除 CA 目录或恢复资料。

## 本地保存与证书

| 数据 | 保存方式 |
| --- | --- |
| 原始 Prompt、替换映射、请求记录 | 网关内存，退出清空 |
| WorkBuddy 登录认证 | 继续由 WorkBuddy 管理；不复制登录凭据 |
| 原代理设置 | 网关用户数据目录下的 `native-https/connection.json`，只保存两个代理字段 |
| 本地 CA 与私钥 | 用户数据目录下的 `native-https/ca`，每台新设备独立生成 |
| 证书撤销身份 | `native-https/certificate.json`，仅保存公钥证书和 SHA-256 |
| 内置规则覆盖与自定义规则 | 网关用户数据目录下的 `rule-settings.json` |

macOS 的用户数据目录为 `~/Library/Application Support/AI Privacy Gateway`，Windows 为 `%APPDATA%/AI Privacy Gateway`。WorkBuddy 的代理配置文件为 `~/.workbuddy-ai/settings.json`。接入仅修改 `http.proxy` 和 `http.proxySupport`，不改模型 URL、Key 或系统全局代理。

macOS 将 CA 信任限制为当前用户、`www.workbuddy.ai` 的 SSL 用途。Windows 使用当前用户根证书存储，系统信任范围不具备同样的域名限制；应用代理本身只解密 `www.workbuddy.ai:443`。停止保护会恢复代理，保留本地证书，供下一次开启复用。

手动恢复：在 WorkBuddy「设置 → 通用 → 网络代理」选择接入前的代理模式和地址，然后应用设置；原来没有代理时选择「直接连接」。若配置未热更新，正常退出并重新打开 WorkBuddy。不要删除证书私钥或复制到其他设备。

## 开发与安装包

```bash
npm ci
npm run prepare:native
npm run dev
```

完整安装包随附 mitmproxy 12.2.3 独立运行时，无需用户安装 Python。`npm run pack`、`npm run dist:mac` 和 `npm run dist:win` 会先准备对应平台运行时。构建脚本从官方来源下载固定版本，并校验 SHA-256；启动应用时不再下载它。

Windows x64 生成 NSIS 安装包，macOS arm64 / x64 生成 DMG 和 ZIP。Windows 实机验证按用户决定后置，签名、公证和更新属于后续正式分发范围。详细命令见 [开发指南](DEVELOPMENT.md)。

## 已知范围

保护端点为 `www.workbuddy.ai:443` 的 `POST /v2/chat/completions`，检查支持的文本、工具描述、参数字符串及客户端元数据。未知字段、非 JSON、多模态或其他不支持格式在模型端点停止外发，并留下失败记录。保留工具结构不代表完整工具循环已通过验收。

独立上传、其他端点及工具直接联网不在当前范围。被代理观察到的范围外请求显示为「未检查」，不计为规则放行；未经过代理的流量无法记录。范围外端点仍可能受代理的正文大小限制而被拒绝，不承诺大文件上传兼容。列表最多保留 100 条，范围外流量最多 20 条；累计计数从启动或清空记录开始，不是客户端所有流量的覆盖率。

完整 Agent、跨轮映射及原生 / SSE 代号恢复属于 M2。状态「已验证」表示请求通过检查和转发，不代表检测不会漏报，也不代表全部客户端或付费套餐已支持。

实现依据：[WorkBuddy 设置文档](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Setting)、本机 WorkBuddy AI 5.5.2 的代理字段与启动逻辑、[mitmproxy 安装说明](https://docs.mitmproxy.org/stable/overview/installation/)、[证书说明](https://docs.mitmproxy.org/stable/concepts/certificates/)。
