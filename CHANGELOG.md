# 0.1.3

### Fix(cli)

- Bun 打包用 `--external "node:*"` 保留所有 Node.js 内置模块 import，修复 `node:fs` 内联后变量丢失导致 hook 静默失败
- 本地验证：hook 正常写入 `.kagent/events.ndjson`

# 0.1.2

### Fix(cli)

- Bun 打包加 `--external node:fs --external node:path`，修复 `node:fs` 内联后 `fs` 变量丢失导致 hook 静默失败
- `src/capture.mjs` 显式 `import fs from "node:fs"`，确保 bundle 后保留

# 0.1.1

### Fix(cli)

- `bin/kagent-cc.mjs` 动态 import 用 `pathToFileURL` 转换 Windows 路径，修复 `ERR_UNSUPPORTED_ESM_URL_SCHEME`

### Chore(ci)

- PR 仅编译检查不打包，push 时才打包上传 artifact
- Node.js 24

# 0.1.0

### Feat(cli)

- `@enigma_soul/kagent-cc` npm 包，`kagent-cc` CLI 入口：默认 = install + tui，`kagent-cc install` 仅装 hooks，`kagent-cc tui` 仅启动 TUI，`kagent-cc uninstall` 移除 hooks
- Claude Code `PostToolUse` Hook 采集：`Edit`/`Write`/`MultiEdit` 三种工具的 payload 映射到 KAgent 事件格式，`session_id` -> `conversation_id`，`cwd` -> `workspaceRoot`
- `src/installer.mjs`：静默安装/卸载 hooks，合并 `.claude/settings.json`（不覆盖已有 hooks），创建 `.kagent/config.json`，追加 `.gitignore`
- Bun 打包 `dist/capture.mjs`（单文件自包含，内联 `record.mjs`）+ `dist/tui.mjs`

### Feat(tui)

- 终端 K 线查看器：零依赖纯 Node.js 内置模块，半块字符（█▀▄）双倍垂直分辨率渲染
- CJK 双宽字符显示宽度对齐（`displayWidth`/`truncateWidth`/`padWidth`/`fitWidth`），ANSI 转义序列保留截断
- 文件名截断：超过 20 字符取后 17 并补 `...`，否则按最大名长对齐
- 文件名着色：退市=灰、新上市=黄、涨=红/绿（跟随 A股/美股）、跌=绿/红、平=默认；箭头颜色同步切换
- y 轴自动缩放：firstOpen 明显高于 dataMin 时启用 1/5 定位，否则紧凑填满；刻度数字贯穿整个图表高度
- 每个列表项占 2 行：第一行箭头+文件名+badge，第二行 meta 信息（笔数/行数/净变化）
- 状态持久化：选中文件、配色方案保存到 `.kagent/tui-state.json`
- 实时刷新：`fs.watch` 监听 `.kagent/` 变化，150ms 防抖

### Feat(extension)

- `hookInstaller.ts` 重写：只装 Claude Code hooks（`.claude/settings.json`），启动时静默检查安装
- 去除 `.cursor/` 和 Cursor hook 相关代码
- 扩展 `resources/kagent-cc-capture.mjs` 替换旧的 `kagent-capture.mjs` + `kagent-record.mjs`

### Chore(ci)

- CI：Bun 打包 npm 产物 + Node.js 24 编译扩展 + 打包 VSIX
- Release：tag `v*` 触发自动发版（npm publish + Open VSX + GitHub Release），PR 合并 main 自动 bump patch + 打 tag
- `.gitignore` 添加 `.claude/`、`.vscode/`、`.cursor/`、`demo/`、`*.log`
- 删除 `demo/` 和所有测试/模拟脚本
