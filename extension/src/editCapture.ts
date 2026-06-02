import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { readSymbols } from "./eventStore";
import { isCaptureOnEditEnabled, isIgnored, loadKagentConfig } from "./kagentConfig";
import { countLines } from "./lineStats";
import { recordFileChange } from "./recordChange";

const DEBOUNCE_MS = 2000;

const lastContent = new Map<string, string>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
let fileWatcher: vscode.FileSystemWatcher | undefined;

function relativePathFromUri(
  uri: vscode.Uri,
  workspaceRoot: string
): string | null {
  const rel = path.relative(workspaceRoot, uri.fsPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return rel.split(path.sep).join("/");
}

function relativePathFromDoc(
  doc: vscode.TextDocument,
  workspaceRoot: string
): string | null {
  if (doc.isUntitled || doc.uri.scheme !== "file") {
    return null;
  }
  return relativePathFromUri(doc.uri, workspaceRoot);
}

function editorId(): string {
  return vscode.env.appName.toLowerCase().includes("cursor") ? "cursor" : "vscode";
}

function readDiskText(workspaceRoot: string, relativeFile: string): string {
  try {
    const abs = path.join(workspaceRoot, relativeFile);
    if (fs.existsSync(abs)) {
      return fs.readFileSync(abs, "utf8");
    }
  } catch {
    /* ignore */
  }
  return "";
}

function isFileOpenInEditor(filePath: string): boolean {
  return vscode.workspace.textDocuments.some(
    (doc) => doc.uri.scheme === "file" && doc.uri.fsPath === filePath
  );
}

function isInKagentDir(uri: vscode.Uri, workspaceRoot: string): boolean {
  const kagentDir = path.join(workspaceRoot, ".kagent");
  return uri.fsPath.startsWith(kagentDir + path.sep) || uri.fsPath === kagentDir;
}

function bootstrapFromSymbols(workspaceRoot: string): void {
  const kagentDir = path.join(workspaceRoot, ".kagent");
  if (!fs.existsSync(kagentDir)) {
    return;
  }
  const symbols = readSymbols(kagentDir);
  for (const relativeFile of Object.keys(symbols.symbols)) {
    if (!lastContent.has(relativeFile)) {
      lastContent.set(relativeFile, readDiskText(workspaceRoot, relativeFile));
    }
  }
}

function bootstrapFromOpenDocuments(workspaceRoot: string): void {
  for (const doc of vscode.workspace.textDocuments) {
    const rel = relativePathFromDoc(doc, workspaceRoot);
    if (rel && !lastContent.has(rel)) {
      lastContent.set(rel, doc.getText());
    }
  }
}

export function bootstrapEditBaselines(workspaceRoot: string): void {
  bootstrapFromSymbols(workspaceRoot);
  bootstrapFromOpenDocuments(workspaceRoot);
}

function flushPendingForFile(relativeFile: string): void {
  const timer = pendingTimers.get(relativeFile);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(relativeFile);
  }
}

function flushAllPending(): void {
  for (const [, timer] of pendingTimers) {
    clearTimeout(timer);
  }
  pendingTimers.clear();
}

function handleDiskChange(workspaceRoot: string, uri: vscode.Uri): void {
  if (isInKagentDir(uri, workspaceRoot)) {
    return;
  }

  const kagentDir = path.join(workspaceRoot, ".kagent");
  if (!isCaptureOnEditEnabled(kagentDir)) {
    return;
  }

  const rel = relativePathFromUri(uri, workspaceRoot);
  if (!rel) {
    return;
  }

  if (rel.startsWith(".kagent/") || rel.startsWith(".kagent\\")) {
    return;
  }

  const config = loadKagentConfig(kagentDir);
  if (isIgnored(rel, config)) {
    return;
  }

  if (isFileOpenInEditor(uri.fsPath)) {
    return;
  }

  flushPendingForFile(rel);

  pendingTimers.set(
    rel,
    setTimeout(() => {
      pendingTimers.delete(rel);
      recordDiskEdit(workspaceRoot, kagentDir, rel, uri.fsPath);
    }, DEBOUNCE_MS)
  );
}

function recordDiskEdit(
  workspaceRoot: string,
  kagentDir: string,
  rel: string,
  absPath: string
): void {
  let newText: string;
  try {
    if (!fs.existsSync(absPath)) {
      return;
    }
    newText = fs.readFileSync(absPath, "utf8");
  } catch {
    return;
  }

  const oldText = lastContent.get(rel);
  if (oldText === undefined) {
    lastContent.set(rel, newText);
    return;
  }

  if (newText === oldText) {
    return;
  }

  const linesAfter = countLines(newText);

  const result = recordFileChange({
    workspaceRoot,
    relativeFile: rel,
    linesAfter,
    oldText,
    source: "onEdit",
    actor: "unknown",
    editor: editorId(),
  });

  if (
    result.recorded ||
    result.reason === "coalesced" ||
    result.reason === "unchanged"
  ) {
    lastContent.set(rel, newText);
  }
}

function recordEditorEdit(
  workspaceRoot: string,
  kagentDir: string,
  rel: string,
  doc: vscode.TextDocument
): void {
  const newText = doc.getText();
  const oldText = lastContent.get(rel);
  if (oldText === undefined) {
    lastContent.set(rel, newText);
    return;
  }

  if (newText === oldText) {
    return;
  }

  const linesAfter = countLines(newText);

  const result = recordFileChange({
    workspaceRoot,
    relativeFile: rel,
    linesAfter,
    oldText,
    source: "onEdit",
    actor: "unknown",
    editor: editorId(),
  });

  if (
    result.recorded ||
    result.reason === "coalesced" ||
    result.reason === "unchanged"
  ) {
    lastContent.set(rel, newText);
  }
}

export function registerEditCapture(context: vscode.ExtensionContext): void {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsRoot) {
    bootstrapEditBaselines(wsRoot);
  }

  if (wsRoot) {
    fileWatcher = vscode.workspace.createFileSystemWatcher("**/*");
    fileWatcher.onDidChange((uri) => {
      if (!isInKagentDir(uri, wsRoot)) {
        handleDiskChange(wsRoot, uri);
      }
    });
    fileWatcher.onDidCreate((uri) => {
      if (!isInKagentDir(uri, wsRoot)) {
        const rel = relativePathFromUri(uri, wsRoot);
        if (rel && !lastContent.has(rel)) {
          lastContent.set(rel, "");
        }
        handleDiskChange(wsRoot, uri);
      }
    });
    fileWatcher.onDidDelete((uri) => {
      if (!isInKagentDir(uri, wsRoot)) {
        const rel = relativePathFromUri(uri, wsRoot);
        if (rel) {
          lastContent.delete(rel);
        }
      }
    });
    context.subscriptions.push(fileWatcher);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        return;
      }
      const rel = relativePathFromDoc(doc, root);
      if (rel && !lastContent.has(rel)) {
        lastContent.set(rel, doc.getText());
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        return;
      }
      const kagentDir = path.join(root, ".kagent");
      if (!isCaptureOnEditEnabled(kagentDir)) {
        return;
      }

      const rel = relativePathFromDoc(e.document, root);
      if (!rel) {
        return;
      }

      const config = loadKagentConfig(kagentDir);
      if (isIgnored(rel, config)) {
        return;
      }

      flushPendingForFile(rel);

      pendingTimers.set(
        rel,
        setTimeout(() => {
          pendingTimers.delete(rel);
          recordEditorEdit(root, kagentDir, rel, e.document);
        }, DEBOUNCE_MS)
      );
    })
  );

  context.subscriptions.push({
    dispose: flushAllPending,
  });
}

export function primeEditBaseline(relativeFile: string, content: string): void {
  lastContent.set(relativeFile, content);
}
