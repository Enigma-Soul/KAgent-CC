# KAgent

[中文](README.md) · [English](README.en.md)

<img src="extension/icon.png" width="64" align="left" hspace="12" />

**把 Agent 的每次改文件，画成一支「股票」的 K 线。**

一个文件 = 一支股票 · 首次被改 = 上市 · 每次编辑 = 一根 K 线

<img width="3840" height="2100" alt="preview" src="https://github.com/user-attachments/assets/6e2aea95-c8a2-4db9-820d-59e7608b2728" />

> [!NOTE]
> 工作区须为 **Trusted**，VS Code 扩展的保存采集才会生效。Claude Code CLI 无此限制。

---

## 特性

- **自动采集**：Claude Code `PostToolUse` Hook / VS Code 保存采集，写入同一份 `.kagent/`
- **双端可视化**：VS Code / Cursor 侧边栏 webview（`lightweight-charts`）+ 终端 TUI（零依赖纯 Node.js），共享数据实时同步
- **细粒度 K 线**：同轮既有删又有增拆成两根；行数不变但内容被改写也记入（语义波动）
- **A 股 / 美股**：红涨绿跌 / 绿涨红跌可切换，亮色 / 暗色色调可选
- **ST 退市**：手动删除已跟踪文件后标记退市，约 30 秒后从列表移除（历史保留）

---

## 快速开始

### 方式一：npx（推荐，无需安装）

在 Claude Code 工作目录下直接运行：

```bash
npx @enigma_soul/kagent-cc
```

这会静默安装 Claude Code hooks 到当前项目。之后 Claude Code 每次编辑文件都会自动采集行情。

查看 K 线图：

```bash
npx @enigma_soul/kagent-cc tui
```

| 命令 | 说明 |
|------|------|
| `npx @enigma_soul/kagent-cc` | 安装 hooks + 启动 TUI（默认） |
| `npx @enigma_soul/kagent-cc install` | 仅安装 hooks |
| `npx @enigma_soul/kagent-cc tui` | 仅启动终端 K 线查看器 |
| `npx @enigma_soul/kagent-cc uninstall` | 移除 hooks |

也可以全局安装后直接使用：

```bash
npm install -g @enigma_soul/kagent-cc
kagent-cc              # 安装 hooks + 启动 TUI
kagent-cc install      # 仅安装 hooks
kagent-cc tui          # 仅启动 TUI
kagent-cc uninstall    # 移除 hooks
```

### 方式二：VS Code / Cursor 扩展

从 [Open VSX](https://open-vsx.org/extension/JStone/kagent) 安装：

```bash
codium --install-extension JStone.kagent
# 或
code --install-extension JStone.kagent
```

或从 [GitHub Releases](https://github.com/Enigma-Soul/KAgent-CC/releases) 下载 `.vsix`：

```bash
cursor --install-extension kagent-0.1.9.vsix
```

安装后 **重新加载窗口**。扩展启动时会自动检查并安装 Claude Code hooks（静默）。

<details>
<summary>从源码打包</summary>

```powershell
cd extension
npm install
npm run compile
npm run package
```

> **Windows**：`npm install` 报 `cp` 不存在时，手动复制图表库：
> ```powershell
> Copy-Item -Force node_modules\lightweight-charts\dist\lightweight-charts.standalone.production.js media\lightweight-charts.js
> ```

</details>

### 看行情

| 入口 | 说明 |
|------|------|
| `kagent-cc tui` | 终端 TUI（无需扩展） |
| 活动栏 **KAgent** 图标 | VS Code / Cursor 侧边栏行情 |
| `KAgent: 打开行情图` | 同上 |

**终端 TUI**：

```
kagent-cc tui
```

零依赖纯 Node.js，Claude Code 每编辑一个文件实时刷新 K 线。状态（选中文件、配色）持久化到 `.kagent/tui-state.json`。

| 按键 | 功能 |
|-----|------|
| `j` / `k` | 切换文件 |
| `s` | 切换 A 股 / 美股配色 |
| `r` | 手动刷新 |
| `q` | 退出 |

**VS Code / Cursor 侧边栏**：

- 左侧列表：每个被跟踪文件 = 一支股票；▲/▼ 涨跌；新 / 改 标记
- 右侧图表：K 线 + 成交量；点击列表项打开文件；拖动缩放后保留视图
- 右上角：切换 A 股 / 美股、亮 / 暗

---

## 概念

| 现实世界 | KAgent |
|---------|--------|
| 一支股票 | 工作区里的 **一个文件** |
| 上市 | **第一次**被记录到该文件 |
| 一根 K 线 | **一轮**编辑（行数开高低收 + 成交量） |
| ST 退市 | **手动删除**已跟踪文件；灰色显示，约 30 秒后下市 |
| 红 / 绿 | **行数**变多或变少（A 股红涨绿跌 / 美股相反，可切换） |

---

## 架构

```mermaid
flowchart LR
  A1[Claude Code 改文件] --> B1[PostToolUse Hook]
  A2[手动保存] --> B2[onSave 采集]
  B1 --> C[".kagent/events.ndjson"]
  B1 --> D[".kagent/symbols.json"]
  B2 --> C
  B2 --> D
  C --> E1[VS Code / Cursor 扩展]
  C --> E2[终端 TUI]
  D --> E1
  D --> E2
  E1 --> F1[侧边栏 K 线图]
  E2 --> F2[终端 K 线图]
```

| 路径 | 作用 |
|------|------|
| `.kagent/events.ndjson` | 每次编辑一条事件（NDJSON） |
| `.kagent/symbols.json` | 已「上市」文件列表（含退市状态） |
| `.kagent/config.json` | 忽略路径（默认排除 `node_modules` 等） |
| `.kagent/tui-state.json` | TUI 状态持久化（选中文件、配色） |

**K 线字段**

| 字段 | 含义 |
|------|------|
| Open / Close | 该根 K 线起止 **行数** |
| High / Low | 该阶段最高 / 最低行数 |
| Volume | 删除或增加的行数 |
| 同轮拆分 | 同一次修改既有删又有增：先「删」K 线，再「增」K 线 |
| 颜色 | 收 ≥ 开为阳；A 股红阳绿阴，美股绿阳红阴 |

---

## 常见问题

| 现象 | 处理 |
|------|------|
| 侧边栏 / TUI 一直是空的 | 确认已安装 hooks 或开启保存采集、工作区 Trusted、改过/保存过文件（或跑模拟脚本） |
| Hooks 不触发 | 必须打开仓库根目录；检查 `.claude/settings.json` 是否存在 |
| 删文件后没有 ST 退市 | 安装 ≥ 0.1.5 并 Reload Window；点刷新行情；仅对已出现在列表中的文件生效 |
| Cursor 里搜不到 KAgent | Cursor 不走 Open VSX，用 [VSIX](#方式二vs-code--cursor-扩展) 或 [Releases](https://github.com/Enigma-Soul/KAgent-CC/releases) |

---

## 开发者

### 本地构建

```bash
# npm 包（需要 Bun）
bun build src/capture.mjs --outfile dist/capture.mjs
bun build src/tui.mjs --outfile dist/tui.mjs

# VS Code 扩展
cd extension
npm install && npm run compile   # 日常开发：npm run watch
npm run package                  # 产出 kagent-x.y.z.vsix
```

| 资源 | 路径 |
|------|------|
| 界面示意 | [docs/images/preview-sidebar.png](docs/images/preview-sidebar.png) |
| 概念示意 | [docs/images/concept.png](docs/images/concept.png) |

### 发布 Release（维护者）

| Workflow | 作用 |
|----------|------|
| [CI](.github/workflows/ci.yml) | push/PR 时 Bun 打包 + 编译扩展 + 打包 VSIX |
| [Release](.github/workflows/release.yml) | tag `v*` 触发：npm publish + Open VSX + GitHub Release |

**发版步骤**

1. `git tag v0.1.0 && git push --tags` 触发自动发版
2. CI 自动：Bun 打包 -> npm publish -> 扩展编译 -> Open VSX publish -> GitHub Release
3. 完成后在 [Releases](https://github.com/Enigma-Soul/KAgent-CC/releases) 下载 VSIX

> 需要配置 GitHub Secrets：`NPM_TOKEN`（npm access token）、`OVSX_PAT`（Open VSX token）

---

## License

[MIT](LICENSE)
