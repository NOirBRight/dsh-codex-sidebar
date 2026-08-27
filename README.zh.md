# dsh-codex-sidebar

[English](README.md) | 中文

给一条 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 主会话加上 Codex 风格右侧栏。Files、Review、Browser、Terminal 四个工具共用当前会话的一条标签栏。

![对话和文件预览](docs/screenshots/01-overview.png)

## 做什么

打开主会话，点对话区标题里的侧栏开关。抽屉占用框架右侧栏，不替换聊天。

- **Files（文件）** — 只读预览（源码、Markdown、图片）和工作区树。点对话里的路径会填进来。
- **Review（审查）** — 先看本轮变更，再看工作区剩余差异。只读：不能暂存、还原或提交。
- **Browser（浏览器）** — 该标签里的托管 Chromium。主会话可用 `browser_tabs`、`browser_open`、`browser_snapshot`、`browser_click`、`browser_fill` 操作本机网页，侧栏开着或关着都行。桌面流使用二进制帧，无 Origin 的 Mobile 隧道使用 JSON Base64；绘制确认会限制截图和传输压力。空闲页会回收；禁止在里面再打开 DSH Web 自己。
- **Terminal（终端）** — 给人用的伪终端（有 `script` 就用），不是智能体的命令行。
- **批注** — 点文件行或页面写备注。发送后官方气泡保持原样，编号标签在气泡下方。定位信息和截图作为同一条用户消息的模型证据，不塞进气泡。
- **编辑行的 +/−** — 每一行 edit/write 显示这一次的增减，跟在文件名后面。

![本轮变更审查](docs/screenshots/03-review.png)

外观跟随 DSH 主题。标签跟着这条主会话保存。侧栏不再提供 Side Chat；跨会话问答请用 DeepSeek 小管家的「引用任务」。

![浏览器空状态](docs/screenshots/04-browser.png)

![终端](docs/screenshots/05-terminal.png)

![空标签的工具面板](docs/screenshots/06-palette.png)

## 安装

需要 DeepSeek Harness 0.1.0-rc.6 或更高：

```sh
dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.3.23
dsh web
```

实验室（`DSH_HOME=~/.dsh-lab`）同样装这个包：

```sh
DSH_HOME=~/.dsh-lab dsh plugin --profile web add github:NOirBRight/dsh-codex-sidebar#v0.3.23
```

仓库里带发布用的 `lib/` 产物，从 GitHub 安装不必放行构建脚本。

0.3.0 起，Review/Files 工作区投影按需异步执行：收起侧栏不会扫描 git；Review 文件列表使用摘要，展开文件时才读取详情。侧栏状态默认按 `DSH_HOME` 隔离保存，并从旧的 `~/.dsh-codex-sidebar/sessions` 按需迁移。超大或二进制文件的详情会显示受限摘要，不会为了生成全量 LCS diff 阻塞宿主。

不要把 `@deepseek-ai/dsh-tools` 等宿主单例写进插件的 `dependencies`。提升进配置目录会盖住宿主的工具运行时，所有工具都会在 `.prepare` 上失败。

托管 Chromium 配置文件的派生缓存预算默认为 256 MiB。需要其他上限时，在插件加载项中配置：

```yaml
- name: dsh-codex-sidebar
  config:
    managedBrowser:
      cacheBudgetBytes: 268435456
```

Chromium 启动前，可恢复的配置文件租约会串行化多个 Host 进程的初始化。白名单缓存超过预算时，插件会重新检查所有权，把身份未变化的目录原子移到插件专属隔离名称，再次检查所有权后只递归删除已脱离配置文件的隔离目录。出现新单例、目录身份变化或所有权不确定时会保留隔离目录而不删除；过期的 Chromium 单例文件交给 Chromium 自身处理。Cookie 和站点存储会保留。插件按已验证的目录身份回收过期的孤立或损坏租约；租约释放失败只记录警告，不会丢弃已经启动的 Context。

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
