#!/usr/bin/env node
/**
 * KAgent Claude Code 采集 hook
 * PostToolUse(Edit|Write|MultiEdit) -> .kagent/
 *
 * stdin 收到 Claude Code 的 PostToolUse JSON，格式：
 * { session_id, cwd, tool_name, tool_input: { file_path, ... }, tool_response }
 */
import fs from "node:fs";
import path from "node:path";
import {
  recordFileChange,
  countFileLines,
  isFileTracked,
} from "./record.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

function toRelative(filePath, root) {
  const rel = path.relative(root, filePath);
  return rel.split(path.sep).join("/");
}

readStdin()
  .then((payload) => {
    if (!payload?.tool_input?.file_path) {
      process.exit(0);
      return;
    }

    const cwd = payload.cwd || process.cwd();
    const filePath = path.resolve(payload.tool_input.file_path);
    const relativeFile = toRelative(filePath, cwd);
    if (relativeFile.startsWith("..")) {
      process.exit(0);
      return;
    }

    const toolName = payload.tool_name;
    let edits;
    let oldText;

    if (toolName === "Edit") {
      edits = [
        {
          old_string: payload.tool_input.old_string ?? "",
          new_string: payload.tool_input.new_string ?? "",
        },
      ];
    } else if (toolName === "MultiEdit") {
      edits = payload.tool_input.edits ?? [];
    } else if (toolName === "Write") {
      if (!isFileTracked(cwd, relativeFile)) {
        oldText = "";
      }
    } else {
      process.exit(0);
      return;
    }

    const linesAfter = countFileLines(filePath);

    recordFileChange({
      workspaceRoot: cwd,
      relativeFile,
      linesAfter,
      edits,
      oldText,
      source: "claude-code",
      actor: "agent",
      editor: "claude-code",
      conversation_id: payload.session_id ?? null,
    });
    process.exit(0);
  })
  .catch((err) => {
    console.error("[kagent-cc-capture]", err.message);
    process.exit(0);
  });
