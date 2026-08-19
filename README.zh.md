# dsh-codex-sidebar

[English](README.md) | 中文

给一条 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 主会话加上 Codex 风格右侧栏。Files、Review、Browser、Terminal 共用当前会话的一条 Tab 带。

![对话 + Files 预览](docs/screenshots/01-overview.png)

## 做什么

打开主会话，点对话区的侧栏开关。抽屉占用 DSH 的 details 列，不替换聊天。

- **Files** — 只读预览（源码、Markdown、图片）和工作区树。点对话里的路径会填进来。
- **Review** — 先看本轮变更，再看工作区剩余 diff。只读：没有 stage / revert / commit。
- **Browser** — 该 Tab 里的托管 Chromium。主会话可用 `browser_tabs` / `browser_open` / `browser_snapshot` / `browser_click` / `browser_fill` 操作本机 http 页，侧栏开着或关着都行。
- **Terminal** — 给人用的 pty（有 `script` 就用），不是 agent shell。
- **批注** — 点文件行或页面写备注。发送后官方气泡保持原样，编号 chip 在气泡下方。定位串和截图作为同一条 user 消息的模型证据，不塞进气泡。
- **Edit +/−** — 每一行 edit/write 显示**这一次**的增减，跟在文件名后面。

![Review 本轮变更](docs/screenshots/03-review.png)

外观跟随 DSH 主题。Tab 跟着这条主会话持久化。Side Chat 已退场；跨会话问答走 DeepSeek 小管家的引用任务。

![Browser](docs/screenshots/04-browser.png)

![Terminal](docs/screenshots/05-terminal.png)

![空 Tab 的 Palette](docs/screenshots/06-palette.png)

## 安装

需要 DeepSeek Harness 0.1.0-rc.6 或更高：

```sh
dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.2.4
dsh web
```

实验室（`DSH_HOME=~/.dsh-lab`）同样装这个包：

```sh
DSH_HOME=~/.dsh-lab dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.2.4
```

仓库跟踪发布用的 `lib/`，GitHub 安装不必放行 build script。

不要把 `@deepseek-ai/dsh-tools` 等宿主单例写进插件 `dependencies`。提升进 profile 会遮蔽宿主 ToolRuntime，所有工具死在 `.prepare`。

## 本地安装

```sh
pnpm install
pnpm test
pnpm run build
dsh plugin --profile web add "$(pwd)"
dsh web
```

然后打开主会话，用侧栏开关。

## 规格

见 `CONTEXT.md` 与 `docs/adr/`。
