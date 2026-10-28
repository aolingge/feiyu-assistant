# 肥鱼 B 站视频助手（DSH）

一个面向 DSH（DeepSeek Harness）的 B 站助手插件，提供视频资料整理、个人记录、通知和可控的账号操作。仓库保留上游包名 `dsh-bili-whale`，以兼容 DSH 插件配置。

这是社区维护的独立项目，不隶属于哔哩哔哩、DeepSeek 或 DSH。代码来自 [Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale) 并保留其 MIT 许可；其他来源见 [NOTICE.md](NOTICE.md)。

## 功能

- 汇总视频简介、官方字幕、弹幕、评论和可选画面材料；保存本地材料与结果缓存。
- 提供 B 站评论、私信、动态、收藏、直播弹幕等命令行工具，其中写操作应先预览，再明确执行。
- 在 DSH 设置页配置人格、偏好、通知、监听与作息。
- 在 DSH 会话中处理监听结果；使用的模型服务遵循你在 DSH 中配置的服务及其隐私政策。

## 安全默认值

新安装默认关闭评论、私信和直播监听，关闭夜间自动唤醒，并关闭自动分享。通知默认关闭。命令行写操作需使用 `--go` 才会实际提交；`--dry` 只预览请求。

启用账号监听会读取相应的 B 站收件箱；启用自动唤醒会向 DSH 会话提交任务；启用分享、评论、私信、动态、收藏或弹幕功能会向 B 站发送请求。打开相关开关前先检查设置和目标范围。请求频率护栏不能保证账号不会受到平台限制，也不替代 B 站规则。

## 环境要求

- Node.js 20 或更新版本。
- 已安装并初始化的 DSH profile。
- 访问 B 站服务所需的网络。视频抽帧需要 FFmpeg；本地语音识别仅在显式启用且已有本地适配器时使用。

## 从源码安装

```powershell
git clone https://github.com/aolingge/feiyu-assistant.git
Set-Location .\feiyu-assistant
$repoPath = (Resolve-Path .).Path
dsh plugin --profile desktop add "link:$repoPath"
```

将 `desktop` 替换为你要使用的 profile。安装后在 DSH 的“设置 → 养鱼”中检查配置。此仓库提供源码安装方式；没有承诺 npm registry 发布。

## 登录与本地数据

优先在 DSH 设置页使用二维码登录。登录凭据保存在当前 Windows 用户目录下的 `.bili-ai/credentials.json`，不会放进此仓库；Unix 系统会限制该文件权限。配置默认位于 `$DSH_HOME/bili-whale.config.json`，可用 `BILI_WHALE_CONFIG` 指定其他位置。可复制 [config.example.json](tools/templates/config.example.json) 作为配置参考，但不要把 Cookie、凭据、真实私信或个人 profile 提交到 GitHub。

插件会向 B 站发送请求；被监听的消息或视频材料也可能作为任务内容交给 DSH 会话及其模型服务。请先阅读所用服务的隐私条款。仓库测试使用模拟数据，不登录真实账号。

## 常用命令

```powershell
node .\tools\bili.mjs --help
node .\tools\bili.mjs comments BVxxxxxxxxxx
node .\tools\bili.mjs subtitles BVxxxxxxxxxx
node .\tools\bili.mjs debrief BVxxxxxxxxxx --no-frames
node .\tools\bili.mjs selftest
```

前三个示例用于读取公开视频资料。`selftest` 会检查本机运行环境和登录状态，应在配置账号后再运行。对会发布或修改内容的命令，先阅读 `--help`，使用 `--dry` 复核目标，确认无误后才使用 `--go`。

## 开发与测试

```powershell
npm ci
npm test
```

GitHub Actions 在 Ubuntu 上覆盖 Node.js 20、22 和 24，并在 Windows 上验证 Node.js 22；两边都会运行离线测试和 JavaScript 语法检查。贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

遵循 [MIT License](LICENSE)。第三方来源与被排除的上游 API 文档见 [NOTICE.md](NOTICE.md)。
