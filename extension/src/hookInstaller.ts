import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const HOOK_FILE = "kagent-cc-capture.mjs";

/** .claude/settings.json 中 KAgent 的 PostToolUse 条目 */
const KAGENT_HOOK_ENTRY = {
  matcher: "Edit|Write|MultiEdit",
  hooks: [
    {
      type: "command",
      command: `node .claude/hooks/${HOOK_FILE}`,
    },
  ],
};

/** 判断 PostToolUse 条目是否属于 kagent */
function isKagentEntry(entry: unknown): boolean {
  const e = entry as { hooks?: Array<{ command?: string }> };
  return Boolean(
    e?.hooks?.some(
      (h) => h.command?.includes("kagent-cc-capture") || h.command?.includes(HOOK_FILE)
    )
  );
}

/** 读取 .claude/settings.json，返回解析后的对象或空对象 */
function readSettings(settingsPath: string): Record<string, unknown> {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

/** 检查 Claude Code hooks 是否已安装 */
export function hooksConfigured(workspaceRoot: string): boolean {
  const settingsPath = path.join(workspaceRoot, ".claude", "settings.json");
  const settings = readSettings(settingsPath);
  const postToolUse = (settings.hooks as { PostToolUse?: unknown[] })?.PostToolUse;
  return Array.isArray(postToolUse) && postToolUse.some(isKagentEntry);
}

/** 确保 hook 脚本和 settings.json 已安装（静默，不弹窗） */
export function ensureClaudeCodeHooks(
  workspaceRoot: string,
  extensionUri: vscode.Uri
): void {
  const claudeDir = path.join(workspaceRoot, ".claude");
  const hooksDir = path.join(claudeDir, "hooks");
  const settingsPath = path.join(claudeDir, "settings.json");
  const hookDest = path.join(hooksDir, HOOK_FILE);

  // 检查是否已安装
  if (hooksConfigured(workspaceRoot) && fs.existsSync(hookDest)) return;

  // 复制 hook 脚本
  const hookSrc = path.join(extensionUri.fsPath, "resources", HOOK_FILE);
  if (!fs.existsSync(hookSrc)) return;
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.copyFileSync(hookSrc, hookDest);

  // 合并 settings.json
  const settings = readSettings(settingsPath);
  if (!settings.hooks) settings.hooks = {};
  const hooks = settings.hooks as { PostToolUse?: unknown[] };
  if (!Array.isArray(hooks.PostToolUse)) hooks.PostToolUse = [];

  if (!hooks.PostToolUse.some(isKagentEntry)) {
    hooks.PostToolUse.push(KAGENT_HOOK_ENTRY);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  }

  // 创建 .kagent/config.json
  const kagentDir = path.join(workspaceRoot, ".kagent");
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

  // 追加 .kagent/ 到 .gitignore
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf8");
    if (!content.includes(".kagent/")) {
      fs.appendFileSync(gitignorePath, "\n.kagent/\n", "utf8");
    }
  } else {
    fs.writeFileSync(gitignorePath, ".kagent/\n", "utf8");
  }
}

/** 手动安装命令（带提示） */
export async function installProjectHooks(
  extensionUri: vscode.Uri
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showErrorMessage("KAgent: 请先打开一个工作区文件夹。");
    return;
  }

  const root = folders[0].uri.fsPath;
  ensureClaudeCodeHooks(root, extensionUri);
  vscode.window.showInformationMessage(
    "KAgent: Claude Code Hooks 已安装。Claude Code 编辑文件后自动产生行情。"
  );
}
