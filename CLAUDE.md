# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commit Attribution

Allow `Co-Authored-By: Claude <noreply@anthropic.com>` trailing attribution lines in commits. Do not add any other AI attribution.

## Project Overview

KAgent-CC 把 Claude Code 的文件编辑以股票 K 线图展示。一个文件 = 一支股票，首次被改 = 上市，每次编辑 = 一根 K 线。

双端可视化：VS Code / Cursor 扩展（webview）+ 终端 TUI（零依赖 Node.js），共享 `.kagent/` 数据。

## Architecture

```
Claude Code edits → PostToolUse Hook → .kagent/ (events.ndjson + symbols.json)
                                            │
                               ┌────────────┴────────────┐
                               ▼                         ▼
                    VS Code 扩展 (webview)          终端 TUI (ANSI)
```

两个可视化端都是 `.kagent/` 的只读消费者，互不依赖。

### npm 包 (`@enigma_soul/kagent-cc`)

- `bin/kagent-cc.mjs` — CLI 入口，dispatch install/uninstall/tui
- `src/capture.mjs` — Claude Code PostToolUse hook 源码，imports `record.mjs`
- `src/record.mjs` — 共享事件记录器（锁、去重、合并、NDJSON 写入）
- `src/tui.mjs` — 终端 K 线查看器（零依赖，ANSI 渲染，CJK 双宽对齐）
- `src/installer.mjs` — install/uninstall 逻辑（合并 `.claude/settings.json`，复制 hook 脚本）
- `dist/` — Bun bundle 产物（CI 生成，gitignored）：`capture.mjs` 和 `tui.mjs` 各自单文件自包含

`kagent-cc`（默认）= install + tui。`kagent-cc install` 仅装 hooks。`kagent-cc tui` 仅启动 TUI。`kagent-cc uninstall` 移除。

### VS Code 扩展 (`extension/`)

TypeScript -> tsc -> `out/extension.js`。打包为 VSIX 发布到 Open VSX。

- `src/extension.ts` — activate 入口，启动时静默安装 Claude Code hooks
- `src/hookInstaller.ts` — 安装 hooks 到 `.claude/`，合并 `settings.json`（不覆盖其他 hooks）
- `src/marketViewProvider.ts` — webview provider，监听 `.kagent/` 变化刷新
- `src/candleBuilder.ts` — K 线构建（同轮拆分：先删后增 = 两根 K 线）
- `src/editCapture.ts` — VS Code 文件监视器采集（onEdit）
- `src/saveCapture.ts` — 保存时采集（onSave）
- `src/recordChange.ts` — TS 版记录器（与 `src/record.mjs` 逻辑一致）
- `resources/kagent-cc-capture.mjs` — 打包好的 hook 脚本（扩展自动安装时复制）
- `media/market.js` — webview 前端（lightweight-charts）
- `media/market.css` — webview 样式

### 数据格式

`.kagent/events.ndjson` — 每次编辑一条 JSON 事件（v2），字段：ts, file, added, removed, net, lines_before/after/high/low, is_ipo, edit_index, source, actor, editor, content_hash_after

`.kagent/symbols.json` — 已上市文件列表，字段：ipo_ts, edit_count, last_lines, last_ts, delisted, last_source, last_content_hash

## Build Commands

```bash
# npm 包（需要 Bun）
bun build src/capture.mjs --outfile dist/capture.mjs
bun build src/tui.mjs --outfile dist/tui.mjs

# 开发：构建 hook 到 .claude/hooks/
bun build src/capture.mjs --outfile .claude/hooks/kagent-cc-capture.mjs

# VS Code 扩展
cd extension
npm install
npm run compile          # tsc -p ./
npm run watch            # tsc -watch
npm run package          # vsce package --no-dependencies -> .vsix

# Windows: npm install 报 cp 不存在时：
# Copy-Item -Force node_modules\lightweight-charts\dist\lightweight-charts.standalone.production.js media\lightweight-charts.js
```

## CI/CD

- `ci.yml` — push/PR 到 main/develop 时：Bun 打包 dist/ + 编译扩展 + 打包 VSIX
- `release.yml` — tag `v*` 触发：npm publish + Open VSX publish + GitHub Release
- 需要 GitHub Secrets：`NPM_TOKEN`、`OVSX_PAT`

## Conventions

- 代码注释中文，AI-prompt `.md` 文件英文
- `.mjs` 文件零依赖（仅 Node.js 内置模块）
- `dist/` 由 Bun CI 生成，不提交
- `.kagent/` 是运行时数据，已 gitignore
- K 线配色：cn=红涨绿跌，us=绿涨红跌，可切换
