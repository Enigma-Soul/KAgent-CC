/**
 * KAgent hook 安装/卸载逻辑
 * 静默操作，仅在出错时输出。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE_SRC = path.resolve(__dirname, "..", "dist", "capture.mjs");
const HOOK_FILE = "kagent-cc-capture.mjs";
const SETTINGS_FILE = "settings.json";

/** 判断 PostToolUse 条目是否属于 kagent */
function isKagentEntry(entry) {
  return entry?.hooks?.some(
    (h) => h.command?.includes("kagent-cc-capture") || h.command?.includes(HOOK_FILE)
  );
}

export function install() {
  const root = process.cwd();
  const claudeDir = path.join(root, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const settingsPath = path.join(claudeDir, SETTINGS_FILE);
  const hookDest = path.join(hooksDir, HOOK_FILE);

  // 1. 复制 bundle 后的 hook 脚本
  if (!fs.existsSync(CAPTURE_SRC)) {
    process.stderr.write("kagent-cc: 找不到 dist/capture.mjs，请先运行 npm run build\n");
    process.exit(1);
  }
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.copyFileSync(CAPTURE_SRC, hookDest);

  // 2. 合并 .claude/settings.json（不覆盖已有 hooks）
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      settings = {};
    }
  }
  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.PostToolUse)) settings.hooks.PostToolUse = [];

  const exists = settings.hooks.PostToolUse.some(isKagentEntry);
  if (!exists) {
    settings.hooks.PostToolUse.push({
      matcher: "Edit|Write|MultiEdit",
      hooks: [
        {
          type: "command",
          command: `node .claude/hooks/${HOOK_FILE}`,
        },
      ],
    });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  }

  // 3. 创建 .kagent/config.json
  const kagentDir = path.join(root, ".kagent");
  if (!fs.existsSync(path.join(kagentDir, "config.json"))) {
    fs.mkdirSync(kagentDir, { recursive: true });
    fs.writeFileSync(
      path.join(kagentDir, "config.json"),
      JSON.stringify(
        {
          ignoreGlobs: [
            "**/node_modules/**",
            "**/.git/**",
            "**/.kagent/**",
            "**/dist/**",
            "**/out/**",
          ],
          capture: { onSave: true, agentHook: true, coalesceWindowMs: 1500 },
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
  }

  // 4. 追加 .kagent/ 到 .gitignore
  const gitignorePath = path.join(root, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(".kagent/")) {
      fs.appendFileSync(gitignorePath, "\n.kagent/\n", "utf8");
    }
  } else {
    fs.writeFileSync(gitignorePath, ".kagent/\n", "utf8");
  }
}

export function uninstall() {
  const root = process.cwd();
  const claudeDir = path.join(root, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const settingsPath = path.join(claudeDir, SETTINGS_FILE);
  const hookDest = path.join(hooksDir, HOOK_FILE);

  // 1. 删除 hook 脚本
  if (fs.existsSync(hookDest)) {
    fs.unlinkSync(hookDest);
  }

  // 2. 从 settings.json 移除 kagent 条目（保留其他 hooks）
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (settings.hooks?.PostToolUse) {
        settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
          (e) => !isKagentEntry(e)
        );
        if (settings.hooks.PostToolUse.length === 0) delete settings.hooks.PostToolUse;
        if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
    } catch {}
  }

  // 3. 清理空 hooks 目录
  if (fs.existsSync(hooksDir)) {
    const remaining = fs.readdirSync(hooksDir);
    if (remaining.length === 0) {
      fs.rmdirSync(hooksDir);
    }
  }
}
