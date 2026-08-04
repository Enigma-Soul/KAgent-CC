#!/usr/bin/env node
/**
 * kagent-cc CLI 入口
 *
 * 用法:
 *   kagent-cc            # 静默安装 hooks（默认）
 *   kagent-cc install    # 同上
 *   kagent-cc uninstall  # 移除 hooks
 *   kagent-cc tui        # 启动终端 K 线查看器
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2] || "install";

if (cmd === "install") {
  const { install } = await import(resolve(__dirname, "../src/installer.mjs"));
  install();
} else if (cmd === "uninstall") {
  const { uninstall } = await import(resolve(__dirname, "../src/installer.mjs"));
  uninstall();
} else if (cmd === "tui") {
  await import(resolve(__dirname, "../src/tui.mjs"));
} else {
  process.stderr.write("Usage: kagent-cc [install|uninstall|tui]\n");
  process.exit(1);
}
