#!/usr/bin/env node
/**
 * kagent-cc CLI 入口
 *
 * 用法:
 *   kagent-cc            # 安装 hooks + 启动 TUI（默认）
 *   kagent-cc install    # 仅安装 hooks
 *   kagent-cc tui        # 仅启动 TUI
 *   kagent-cc uninstall  # 移除 hooks
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] || "default";

if (cmd === "default" || cmd === "install" || cmd === "tui") {
  if (cmd === "default" || cmd === "install") {
    const { install } = await import(resolve(__dirname, "../src/installer.mjs"));
    install();
  }
  if (cmd === "default" || cmd === "tui") {
    await import(resolve(__dirname, "../src/tui.mjs"));
  }
} else if (cmd === "uninstall") {
  const { uninstall } = await import(resolve(__dirname, "../src/installer.mjs"));
  uninstall();
} else {
  process.stderr.write("Usage: kagent-cc [install|tui|uninstall]\n");
  process.exit(1);
}
