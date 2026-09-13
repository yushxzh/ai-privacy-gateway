# 开发、测试与协议范围

本文记录 0.1.7 的实际开发方式与接口范围。产品需求和后续排期见 [全局 PRD](PRD.md)，实际操作见 [WorkBuddy 使用指南](USAGE.md)。

## 准备环境

- Node.js 22.12+，推荐 Node.js 24；使用 npm 和仓库中的依赖锁文件。
- 桌面目标为 macOS 和 Windows。原生运行时脚本提供 macOS arm64 / x64、Windows x64。
- 安装依赖和准备原生运行时需要联网；运行已构建应用无需另装 Node.js 或 Python。

```bash
git clone https://github.com/yushxzh/ai-privacy-gateway.git
cd ai-privacy-gateway
npm ci
npm run prepare:native
npm run dev
```

`prepare:native` 从官方来源下载固定的 mitmproxy 12.2.3 运行时，校验 SHA-256 后放入被 Git 忽略的 `resources/native/`。只开发普通 API 入口时可跳过这一步。若终端设置了 `ELECTRON_RUN_AS_NODE`，启动前移除该变量。

应用启动会监听普通 API 端口，默认上游为离线演示服务；不会自动发送模型请求。WorkBuddy 原生保护需单独开启，实际请求仍发往原官方服务。开发与测试样例保留在代码中，不预填用户记录。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式启动 Electron 与前端 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run check` | 类型检查和核心 / 本地 HTTP / 配置测试 |
| `npm run test:native` | 原生适配与真实 TLS 进程测试，需下面的 Python 测试环境 |
| `npm run test:desktop` | 构建并运行真实 Electron 窗口交互测试 |
| `npm run build` | 编译到 `out/` |
| `npm start` | 启动已编译的应用 |
| `npm run pack` | 准备运行时并生成当前平台应用目录 |
| `npm run dist:mac` | 准备运行时并构建 macOS DMG / ZIP |
| `npm run dist:win` | 准备 Windows x64 运行时并构建 NSIS 安装包 |

本轮在 macOS 构建两个 macOS 架构及 Windows x64 安装包。预览版未正式签名或公证；Windows 实机验证按用户决定后置。构建成功不代表 Windows 安装、授权和卸载已经验收。构建另一 macOS 架构前先准备对应运行时：

```bash
node scripts/prepare-native.mjs mac-x64
npm run dist:mac -- --arm64 --x64 --config.directories.output=release/0.1.7
npm run dist:win -- --config.directories.output=release/0.1.7
```

源码和安装包按同一版本标签发布，附下载文件及 SHA-256 清单。Windows 卸载钩子调用应用的 `--prepare-uninstall`：正常关闭 WorkBuddy、恢复受管理模型与原代理、撤销证书，成功后才删除应用。更新安装跳过清理，失败退出保留应用供重试。

### 原生测试环境

仅原生适配开发测试需要安装了 `mitmproxy==12.2.3` 的 Python 3.12+ 环境。它不是最终用户运行 App 的前提。

macOS：

```bash
python3 -m venv work/test-python
work/test-python/bin/python -m pip install mitmproxy==12.2.3
APG_TEST_PYTHON="$PWD/work/test-python/bin/python" npm run test:native
```

运行前确认 `python3` 为 3.12 或以上。Windows PowerShell 对应命令如下；命令及原生行为仍需随 Windows 真机验收核对：

```powershell
py -3.12 -m venv work/test-python
./work/test-python/Scripts/python.exe -m pip install mitmproxy==12.2.3
$env:APG_TEST_PYTHON = (Resolve-Path ./work/test-python/Scripts/python.exe).Path
npm run test:native
```

`APG_TEST_MITMDUMP` 可指定待验证的独立 `mitmdump` 文件；未设置时使用该 Python 环境中的程序。例如在 macOS arm64 验证随包运行时：

```bash
APG_TEST_PYTHON="$PWD/work/test-python/bin/python" \
APG_TEST_MITMDUMP="$PWD/resources/native/mac-arm64/mitmproxy.app/Contents/MacOS/mitmdump" \
npm run test:native
```

原生测试使用临时证书和本地请求，不向系统导入证书。桌面测试使用隔离的用户数据目录和临时端口，不读取真实 WorkBuddy 登录配置。测试截图及日志保存在被忽略的目录中。

### 已有验证证据

0.1.7 当前检查：147 项核心检查通过；macOS arm64 及 Rosetta 上的 x64 运行时各通过 5 项原生检查。桌面交互及真实 WorkBuddy 文本请求另有验收；最终证据与未测环境以 [M1 交付记录](M1-DELIVERY.md) 为准。检测样例通过不等于独立真实语料上的准确率。

## 两类本地入口

| 入口 | 地址 | 用途 |
| --- | --- | --- |
| 普通 API | 默认 `http://127.0.0.1:8787/v1` | SDK、自定义 API 与原认证实验路由；端口可在设置中调整 |
| WorkBuddy 原生 HTTPS 代理 | `http://127.0.0.1:18788` | App 一键配置 WorkBuddy 网络代理，保留原登录与模型 |

普通 API 地址不能作为 HTTPS 网络代理地址使用；两者共享隐私规则和记录，但协议处理不同。

### 普通 API 端点

| 方法 | 路径 | 范围 |
| --- | --- | --- |
| GET | `/health` | 无敏感内容的健康检查，无需令牌 |
| GET | `/v1/models` | 当前配置模型，需要本地令牌 |
| POST | `/v1/chat/completions` | OpenAI-compatible 文本子集 |
| POST | `/v1/responses` | 文本子集，强制 `store: false` |
| POST | `/v1/messages` | Anthropic 文本子集 |
| POST | `/v1/messages/count_tokens` | 文本计数；离线演示计数是估算 |
| POST | `/native/codex/responses` | Codex 原认证实验入口，需启用该模式 |
| POST | `/native/claude/v1/messages` | Claude Code 原认证实验入口 |
| POST | `/native/claude/v1/messages/count_tokens` | Claude Code 原认证文本计数 |
| GET | `/workbuddy/<本地通行值>/v1/models` | 已启用的 WorkBuddy 自定义模型 |
| POST | `/workbuddy/<本地通行值>/v1/chat/completions` | 每个 WorkBuddy 自定义模型的文本入口 |

普通 API 只接收未压缩的 JSON 文本请求和明确支持的生成参数。WorkBuddy 自定义 API 入口会移除已识别的工具声明与内部元数据；实际工具调用、工具结果、图片、音频、文件、远端会话引用和未知字段仍被拒绝。不提供 Embeddings，不执行自动策略路由，也不做任意供应商之间的协议互转。

非流式 JSON 响应可以在本机恢复原值；SSE 转发保留代号。普通入口使用独立本地令牌；原认证实验入口使用额外的本地 Header，原模型认证仅转发到对应官方地址。自定义模型的本地通行值不发送给上游。

### WorkBuddy 原生入口

原生代理限定解密 `www.workbuddy.ai:443`。`POST /v2/chat/completions` 接受白名单字段、文本块、工具结构与 `extra_vars` 等已适配元数据；文本及元数据字符串进入同一检查和实际正文确认。JSON 重复字段、非有限数值、未知字段、不支持的类型、编码和解压超限均拒绝。

模型端点按路径识别，编码、大小写、重复斜杠及点路径不能把它降为范围外流量。不支持的模型端点版本、方法、查询参数或内容返回 422；本地检查或最终正文确认失败返回 502。独立上传、其他端点等范围外流量可继续转发，但只记录固定的未检查原因，不保存正文、认证、路径或查询参数；不计为规则放行。未经过代理的请求没有观察证据。


命中主动阻断规则时返回 422，避免将内容策略拒绝伪装为认证失效；实际原服务的认证错误仍按上游响应处理。WorkBuddy 当前可能只显示通用服务错误，具体规则和动作需要查看网关记录。

### 限制与错误

| 范围 | 当前行为 |
| --- | --- |
| 普通 API 请求正文 | 最多 256 KiB，超过返回 413 |
| 普通 API 并发 | 最多 4 个处理请求，超过返回 429 |
| 普通 API 上游非流式响应 | 最多 8 MiB，恢复结果另有容量保护 |
| 普通 API 不支持的字段 / 路径 | 字段返回 400；路径返回 404；WebSocket 返回 501 |
| 普通 API 内容阻断 | 403，错误类型为 `privacy_blocked` |
| 原生模型正文 | 原始及解压后的正文不超过 4 MiB；最多 16 条待完成检查；字段数量和深度另有限制 |
| 原生代理传输层 | 可确定长度或缓冲中的 HTTP 正文另受 4 MiB 限制，范围外端点也可能因超限被拒绝 |
| 原生主动阻断 / 检查失败 | 分别返回 422 / 502，不将失败正文交给上游 |
| 请求记录 | 最多 100 条、范围外记录最多 20 条，总计不超过 8 MiB；原文与替换预览各最多 24,000 字符 |

原生和普通 API 的限制不同，不能套用同一组状态码。接口实现以 [服务端](../src/gateway/server.ts)、[普通协议校验](../src/gateway/protocol.ts)、[原生适配器](../src/https/workbuddy.py) 和 [正文确认](../src/gateway/native-inspection.ts) 为准。

## 本地请求示例

在 App「保护 → 连接一个应用 → OpenAI SDK」复制配置并在当前终端执行后：

```bash
node examples/request.mjs
```

该示例不需要额外依赖，只接受回环地址。默认离线上游不会调用云端；配置真实服务后，示例会使用该服务的实际 API 额度。请使用合成内容。

## 目录

```text
src/
  main/          桌面生命周期、接入与恢复、证书及进程管理
  preload/       受限桌面桥
  renderer/      React 界面
  gateway/       API、协议、路由、记录与原生检查入口
  https/         WorkBuddy HTTPS 正文适配
  privacy/       检测、规则、策略与替换映射
  shared/        类型、规则目录与接入说明生成
resources/       应用图标；原生运行时目录不进入 Git
scripts/         原生运行时准备
examples/        本地请求示例
tests/           检测、HTTP、接入、原生与桌面测试
docs/            PRD、使用、架构与验收文档
```

规则配置、接入恢复资料、CA 和私钥保存在用户数据目录；原文记录与映射默认仅在内存。`work/`、构建产物和本机敏感文件均不进入 Git。详细的数据与访问约束见 [架构说明](ARCHITECTURE.md)。
