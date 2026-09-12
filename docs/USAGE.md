# WorkBuddy 一键接入

适用版本：0.1.6。已提供 WorkBuddy 一键接入；应用不包含语义模型，Windows 真机验收尚未完成。

## 操作

1. 安装并登录 WorkBuddy，保留原订阅和模型选择。
2. 打开 AI Privacy Gateway，在「保护」页点击「一键开启保护」。先保存 WorkBuddy 中正在进行的任务，接入会正常退出并重新打开 WorkBuddy。
3. 首次安装需要完成系统证书授权。已有同一证书的有效信任时，不重复授权。
4. 状态显示「已配置 · 等待请求」后，在 WorkBuddy 新建一条文本任务。
5. 发送完成后回到网关。状态变为「已验证」时，表示本次接入后已有请求通过正文检查，且原官方服务返回成功。
6. 查看「记录」中的替换内容、命中规则和正文校验。模型回复内容不能单独作为是否过滤的依据。

目前从源码构建使用。运行 `npm run pack` 后，macOS Apple Silicon 的应用位于 `release/mac-arm64/AI Privacy Gateway.app`，双击即可启动；无需填写实验环境变量。其他架构及 Windows 的产物位于 `release/` 下对应目录。

```text
请写一句会议提醒，联系邮箱 oneclick@example.com。只回复文字，不调用工具、不访问网站、不读写文件。
```

此消息仅含合成联系方式，但会使用 WorkBuddy 现有账号额度。规则的默认处理动作是替换，可以在「规则」中改为阻断、关闭，或添加自定义规则。

## 停止与退出

「停止并恢复」会先正常关闭 WorkBuddy，恢复接入前的代理设置，再重新打开原来正在运行的 WorkBuddy。恢复成功后才停止本地代理。正常退出网关、关闭网关窗口、在「设置」停止网关，也会先执行恢复。

接入期间修改的其他 WorkBuddy 设置会保留。如果用户已换成另一代理，恢复时保留后来选择的代理，不覆盖它。旧版本手动填入本地代理且没有备份的连接，接管后默认恢复为「直接连接」。

遇到 WorkBuddy 未能退出或重启失败时，网关显示错误并保留恢复资料；请先正常退出 WorkBuddy，然后点击「停止并恢复」。不会强制结束未保存的工作。

强制结束网关或系统崩溃时，不能保证即时恢复客户端设置。TLS 子进程会在检查入口连续失联后退出；在网关重新打开并恢复连接之前，WorkBuddy 可能暂时无法请求。重新打开网关会尝试恢复同一连接，仍需用新请求重新验证。

## 本地保存与证书

| 数据 | 保存方式 |
| --- | --- |
| 原始 Prompt、替换映射、请求记录 | 网关内存，退出清空 |
| WorkBuddy 登录认证 | 继续由 WorkBuddy 管理；不复制登录凭据 |
| 原代理设置 | 网关用户数据目录下的 `native-https/connection.json`，只保存两个代理字段 |
| 本地 CA 与私钥 | 用户数据目录下的 `native-https/ca`，每台新设备独立生成 |
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

Windows x64 接入代码与打包配置已提供，Windows 真机验收未完成。macOS 当前构建也尚未进行正式签名、公证或公开发布。

## 已知范围

本轮只提供 WorkBuddy 的一键接入，不将其外推到 Codex、Claude Code 或全部平台。原生入口的图片、文件、完整 Agent 工具循环、SSE 代号恢复等边界沿用之前版本。状态「已验证」表示请求通过检查和转发，不代表检测不会漏报，也不代表长期账号风险结论。

实现依据：[WorkBuddy 设置文档](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Setting)、本机 WorkBuddy AI 5.5.2 的代理字段与启动逻辑、[mitmproxy 安装说明](https://docs.mitmproxy.org/stable/overview/installation/)、[证书说明](https://docs.mitmproxy.org/stable/concepts/certificates/)。
