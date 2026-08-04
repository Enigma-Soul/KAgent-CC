#!/usr/bin/env node
/**
 * KAgent TUI - 终端 K 线行情查看器
 * 零依赖，纯 Node.js 内置模块。
 *
 * 用法: kagent-cc tui 或 kagent-cc（默认 = install + tui）
 * 按键: j/k 切换文件 · s 切换 A股/美股 · r 刷新 · q 退出
 */
import fs from "node:fs";
import path from "node:path";

// ─── ANSI ────────────────────────────────────────────────────────────
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  cursorHide: "\x1b[?25l",
  cursorShow: "\x1b[?25h",
  clear: "\x1b[2J",
  home: "\x1b[H",
  clearLine: "\x1b[2K",
};

// ─── 终端显示宽度 ──────────────────────────────────────────────────────
const CJK_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3040, 0x33bf], [0x3400, 0x4dbf],
  [0x4e00, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe6f], [0xff01, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff],
];

/** 判断码点是否为 CJK 双宽字符 */
function isCjk(code) {
  return CJK_RANGES.some(([lo, hi]) => code >= lo && code <= hi);
}

/** 计算字符串在终端中的显示宽度（ANSI 转义不计，CJK 双宽） */
function displayWidth(str) {
  const s = str.replace(/\x1b\[[0-9;]*m/g, "");
  let w = 0;
  for (const ch of s) {
    w += isCjk(ch.codePointAt(0)) ? 2 : 1;
  }
  return w;
}

/** 按显示宽度截断字符串，保留 ANSI 转义序列 */
function truncateWidth(str, maxW) {
  let w = 0;
  let result = "";
  let i = 0;
  while (i < str.length) {
    // ANSI 转义序列：原样保留，不计宽度
    if (str[i] === "\x1b") {
      const m = str.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (m) {
        result += m[0];
        i += m[0].length;
        continue;
      }
    }
    const ch = str[i];
    const cw = isCjk(ch.codePointAt(0)) ? 2 : 1;
    if (w + cw > maxW) break;
    result += ch;
    w += cw;
    i++;
  }
  return result;
}

/** 按显示宽度右填充空格 */
function padWidth(str, targetW) {
  const w = displayWidth(str);
  return str + " ".repeat(Math.max(0, targetW - w));
}

/** 截断到指定显示宽度后再填充到该宽度 */
function fitWidth(str, w) {
  return padWidth(truncateWidth(str, w), w);
}

// ─── 数据读取 ──────────────────────────────────────────────────────────
function readEvents(kagentDir) {
  const filePath = path.join(kagentDir, "events.ndjson");
  if (!fs.existsSync(filePath)) return [];
  const events = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {}
  }
  return events;
}

function readSymbols(kagentDir) {
  const filePath = path.join(kagentDir, "symbols.json");
  if (!fs.existsSync(filePath)) return { symbols: {} };
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { symbols: {} };
  }
}

// ─── K 线构建（移植自 candleBuilder.ts） ───────────────────────────────
function clampHighLow(open, close, high, low) {
  const bodyTop = Math.max(open, close);
  const bodyBottom = Math.min(open, close);
  let h = high ?? bodyTop;
  let l = low ?? bodyBottom;
  h = Math.max(h, bodyTop);
  l = Math.min(l, bodyBottom);
  return { high: h, low: l };
}

function eventToCandles(e) {
  const removed = e.removed ?? 0;
  const added = e.added ?? 0;
  const base = {
    time: Math.floor(e.ts / 1000),
    edit_index: e.edit_index,
    is_ipo: e.is_ipo,
  };

  if (removed > 0 && added > 0) {
    const mid = Math.max(0, e.lines_before - removed);
    const drop = clampHighLow(e.lines_before, mid, e.lines_high, e.lines_low);
    const rise = clampHighLow(mid, e.lines_after, e.lines_high, e.lines_low);
    return [
      { ...base, open: e.lines_before, close: mid, high: drop.high, low: drop.low, volume: removed, sub_step: 1, leg: "drop" },
      { ...base, open: mid, close: e.lines_after, high: rise.high, low: rise.low, volume: added, sub_step: 2, leg: "rise", is_ipo: false },
    ];
  }

  const { high, low } = clampHighLow(e.lines_before, e.lines_after, e.lines_high, e.lines_low);
  return [{ ...base, open: e.lines_before, close: e.lines_after, high, low, volume: (e.added ?? 0) + (e.removed ?? 0) }];
}

function buildCandlesForFile(events, file) {
  return events
    .filter((e) => e.file === file)
    .sort((a, b) => a.edit_index - b.edit_index)
    .flatMap(eventToCandles);
}

function lastEditTrend(candles) {
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  if (last.close > last.open) return "up";
  if (last.close < last.open) return "down";
  return "flat";
}

function buildSymbolList(events, symbolsDoc, workspaceRoot) {
  const now = Date.now();
  const ACTIVITY_MS = 60_000;
  const netByFile = new Map();
  for (const e of events) {
    netByFile.set(e.file, (netByFile.get(e.file) ?? 0) + e.net);
  }

  const files = new Set([...Object.keys(symbolsDoc.symbols), ...events.map((e) => e.file)]);
  return [...files]
    .map((file) => {
      const info = symbolsDoc.symbols[file];
      const candles = buildCandlesForFile(events, file);
      const ipo_ts = info?.ipo_ts ?? events.find((e) => e.file === file)?.ts ?? 0;
      const last_ts = info?.last_ts ?? ipo_ts;
      const isDelisted = workspaceRoot && !fs.existsSync(path.join(workspaceRoot, file));
      return {
        file,
        ipo_ts,
        edit_count: info?.edit_count ?? candles.length,
        last_lines: info?.last_lines ?? 0,
        last_ts,
        total_net: netByFile.get(file) ?? 0,
        last_trend: lastEditTrend(candles),
        is_new: now - ipo_ts < ACTIVITY_MS,
        is_recent: now - last_ts < ACTIVITY_MS && now - ipo_ts >= ACTIVITY_MS,
        is_delisted: isDelisted,
        candles,
      };
    })
    .sort((a, b) => {
      const ad = a.is_delisted ? 1 : 0;
      const bd = b.is_delisted ? 1 : 0;
      if (ad !== bd) return ad - bd;
      return b.last_ts - a.last_ts;
    });
}

// ─── 终端渲染 ──────────────────────────────────────────────────────────
function getTermSize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

const NAME_MAX = 20;

function shortName(file) {
  const p = file.split("/");
  return p.length <= 2 ? file : p.slice(-2).join("/");
}

/** 文件名截断：超过 NAME_MAX 取后 (NAME_MAX-3) 并补 "..."，否则原样 */
function formatName(name, nameW) {
  const truncated = name.length > NAME_MAX ? "..." + name.slice(-(NAME_MAX - 3)) : name;
  return padWidth(truncated, nameW);
}

function trendArrow(trend) {
  if (trend === "up") return "▲";
  if (trend === "down") return "▼";
  if (trend === "flat") return "─";
  return "·";
}

function colorForCandle(candle, scheme) {
  const isUp = candle.close >= candle.open;
  if (scheme === "us") return isUp ? ANSI.green : ANSI.red;
  return isUp ? ANSI.red : ANSI.green;
}

/**
 * 渲染 K 线图区域。使用半块字符（█▀▄）实现双倍垂直分辨率。
 * @returns {string[]} 行数组
 */
function renderChart(candles, scheme, chartW, chartH) {
  if (!candles.length) return [ANSI.dim + "  (无 K 线数据)" + ANSI.reset];

  const labelW = 5;
  const plotW = Math.max(8, chartW - labelW);
  const maxCandles = Math.floor(plotW / 2);
  const visible = candles.length > maxCandles ? candles.slice(-maxCandles) : candles;
  const startIdx = candles.length - visible.length;

  let dataMax = -Infinity;
  let dataMin = Infinity;
  for (const c of visible) {
    dataMax = Math.max(dataMax, c.high);
    dataMin = Math.min(dataMin, c.low);
  }
  if (dataMax === dataMin) {
    dataMax += 1;
    dataMin = Math.max(0, dataMin - 1);
  }

  // y 轴范围：firstOpen 明显高于 dataMin 时启用 1/5 定位，否则紧凑填满
  const firstOpen = visible[0].open;
  const dataRange = dataMax - dataMin;
  let pMin, pMax;
  if (firstOpen - dataMin > dataRange * 0.3) {
    const r1 = (firstOpen - dataMin) / 0.2;
    const r2 = (dataMax - firstOpen) / 0.8;
    const range = Math.min(Math.max(r1, r2, 1), dataRange * 2.5);
    pMin = Math.max(0, firstOpen - range * 0.2);
    pMax = firstOpen + range * 0.8;
  } else {
    // 紧凑模式：数据范围直接作为 y 轴范围，填满整个图表高度
    pMin = Math.max(0, dataMin);
    pMax = dataMax;
  }
  if (pMax === pMin) pMax = pMin + 1;

  const priceRange = pMax - pMin;
  const halfRows = chartH - 2;
  const totalHalfUnits = priceRange * 2;
  const unitsPerHalfRow = totalHalfUnits / Math.max(1, halfRows);

  const lines = [];

  for (let row = 0; row < halfRows; row++) {
    const topPrice = pMax - row * unitsPerHalfRow;
    const botPrice = pMax - (row + 1) * unitsPerHalfRow;

    // 刻度标签：贯穿整个图表高度，只要 >= 0 就显示
    const label = topPrice >= 0
      ? String(Math.round(topPrice)).padStart(4)
      : "    ";
    let line = ANSI.dim + label + " " + ANSI.reset;

    for (const c of visible) {
      const color = colorForCandle(c, scheme);
      const bodyTop = Math.max(c.open, c.close);
      const bodyBot = Math.min(c.open, c.close);

      const topInBody = topPrice <= bodyTop && topPrice >= bodyBot;
      const botInBody = botPrice <= bodyTop && botPrice >= bodyBot;
      const topInWick = topPrice <= c.high && topPrice >= c.low;
      const botInWick = botPrice <= c.high && botPrice >= c.low;

      let ch;
      if (topInBody && botInBody) ch = "█";
      else if (topInBody && !botInBody) ch = "▀";
      else if (!topInBody && botInBody) ch = "▄";
      else if (topInWick || botInWick) ch = "│";
      else ch = " ";

      if (ch === " ") {
        line += "  ";
      } else {
        line += color + ch + ANSI.reset + " ";
      }
    }
    lines.push(line);
  }

  // 底部轮次轴
  let axisLine = ANSI.dim + "     " + ANSI.reset;
  for (let i = 0; i < visible.length; i++) {
    const realIdx = startIdx + i + 1;
    if (visible.length <= 8 || i % Math.ceil(visible.length / 6) === 0 || i === visible.length - 1) {
      axisLine += ANSI.dim + String(realIdx).padStart(1) + ANSI.reset + " ";
    } else {
      axisLine += "  ";
    }
  }
  lines.push(axisLine);

  // 成交量条
  const maxVol = Math.max(...visible.map((c) => c.volume ?? 0), 1);
  const volChars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  let volLine = ANSI.dim + " vol " + ANSI.reset;
  for (const c of visible) {
    const ratio = (c.volume ?? 0) / maxVol;
    const idx = Math.min(volChars.length - 1, Math.floor(ratio * volChars.length));
    const color = colorForCandle(c, scheme);
    volLine += color + volChars[idx] + ANSI.reset + " ";
  }
  lines.push(volLine);

  return lines;
}

function render(selectedIndex, scheme, kagentDir, workspaceRoot) {
  const { cols, rows } = getTermSize();
  const events = readEvents(kagentDir);
  const symbolsDoc = readSymbols(kagentDir);
  const list = buildSymbolList(events, symbolsDoc, workspaceRoot);

  // 文件名宽度：全部 ≤ NAME_MAX 时取最大名长，否则取 NAME_MAX
  const allNames = list.map((s) => shortName(s.file));
  const maxNameLen = allNames.reduce((m, n) => Math.max(m, n.length), 0);
  const nameW = Math.min(maxNameLen, NAME_MAX);
  // listW = prefix(2) + arrow(1) + space(1) + nameW + space(1) + badge(2) + space(1) + meta(约8显示宽)
  const listW = nameW + 16;
  const chartW = cols - listW - 1;
  const headerH = 2;
  const footerH = 2;
  const bodyH = rows - headerH - footerH;

  let out = ANSI.clear + ANSI.home + ANSI.cursorHide;

  // ── 顶部标题栏 ──
  const schemeLabel = scheme === "cn" ? "A股 红涨绿跌" : "美股 绿涨红跌";
  const titleLine = ANSI.bold + " KAgent 行情" + ANSI.reset +
    "  " + ANSI.dim + "│" + ANSI.reset + "  " + ANSI.dim + schemeLabel + ANSI.reset;
  out += ANSI.clearLine + titleLine + "\n";
  out += ANSI.clearLine + ANSI.dim + "─".repeat(cols) + ANSI.reset + "\n";

  // ── 左侧文件列表 ──
  const listLines = [];
  listLines.push(ANSI.dim + ` 文件 (${list.length})` + ANSI.reset);

  if (list.length === 0) {
    listLines.push(ANSI.dim + " 暂无股票" + ANSI.reset);
    listLines.push(ANSI.dim + " Claude Code 编辑" + ANSI.reset);
    listLines.push(ANSI.dim + " 文件后出现" + ANSI.reset);
  }

  const maxListItems = Math.floor((bodyH - 1) / 2); // 每项 2 行
  let scrollOffset = 0;
  if (list.length > maxListItems) {
    if (selectedIndex > maxListItems - 3) {
      scrollOffset = Math.min(list.length - maxListItems, selectedIndex - Math.floor(maxListItems / 2));
    }
  }
  const visibleList = list.slice(scrollOffset, scrollOffset + maxListItems);

  for (let i = 0; i < visibleList.length; i++) {
    const idx = scrollOffset + i;
    const s = visibleList[i];
    const isSelected = idx === selectedIndex;
    const arrow = trendArrow(s.is_delisted ? null : s.last_trend);
    // 箭头颜色跟随 A股/美股 配色
    const arrowColor = s.last_trend === "up"
      ? (scheme === "us" ? ANSI.green : ANSI.red)
      : s.last_trend === "down"
        ? (scheme === "us" ? ANSI.red : ANSI.green)
        : ANSI.gray;
    const name = formatName(shortName(s.file), nameW);
    const badge = s.is_delisted ? "ST" : s.is_new ? "新" : s.is_recent ? "改" : "";
    const meta = `${s.edit_count}笔 ${s.last_lines}行 净${s.total_net >= 0 ? "+" : ""}${s.total_net}`;

    const prefix = isSelected ? "› " : "  ";
    // 文件名着色：退市=灰、新上市=黄、涨=红/绿、跌=绿/红、平=默认
    let nameColor = "";
    if (s.is_delisted) nameColor = ANSI.dim;
    else if (s.is_new) nameColor = ANSI.yellow;
    else if (s.last_trend === "up") nameColor = scheme === "us" ? ANSI.green : ANSI.red;
    else if (s.last_trend === "down") nameColor = scheme === "us" ? ANSI.red : ANSI.green;

    // 第一行：箭头 + 文件名 + badge
    let line1 = isSelected ? ANSI.bold + prefix + ANSI.reset : prefix;
    line1 += arrowColor + arrow + ANSI.reset;
    line1 += " " + nameColor + name + ANSI.reset;
    if (badge) line1 += ANSI.dim + " " + badge + ANSI.reset;

    // 第二行：meta 信息（缩进对齐到文件名位置）
    let line2 = "  " + ANSI.dim + "  " + meta + ANSI.reset;

    listLines.push(fitWidth(line1, listW));
    listLines.push(fitWidth(line2, listW));
  }

  // ── 右侧图表 ──
  const selected = list[selectedIndex];
  let chartLines = [];
  if (selected && selected.candles.length > 0) {
    chartLines = renderChart(selected.candles, scheme, chartW, bodyH);
  } else if (selected) {
    chartLines = [ANSI.dim + "  " + selected.file + "（暂无 K 线）" + ANSI.reset];
  } else {
    chartLines = [ANSI.dim + "  选择左侧文件查看 K 线" + ANSI.reset];
  }

  // ── 组装左右分栏 ──
  for (let r = 0; r < bodyH; r++) {
    const leftLine = fitWidth(listLines[r] || "", listW);
    const rightLine = chartLines[r] || "";
    out += ANSI.clearLine + leftLine + ANSI.dim + "│" + ANSI.reset + rightLine + "\n";
  }

  // ── 底部 OHLCV 状态栏 ──
  let ohlcLine = "";
  if (selected && selected.candles.length > 0) {
    const last = selected.candles[selected.candles.length - 1];
    const legLabel = last.leg === "drop" ? " 删" : last.leg === "rise" ? " 增" : "";
    ohlcLine = ANSI.dim + " " +
      `轮${last.edit_index}${legLabel}${last.is_ipo ? " 上市" : ""}  ` +
      `开${last.open}  高${last.high}  低${last.low}  收${last.close}  量${last.volume}` +
      ANSI.reset;
  } else if (selected) {
    ohlcLine = ANSI.dim + " " + selected.file + ANSI.reset;
  }
  out += ANSI.clearLine + ohlcLine + "\n";

  // ── 操作提示 ──
  out += ANSI.clearLine + ANSI.dim + " j/k切换 · s配色 · r刷新 · q退出" + ANSI.reset;

  process.stdout.write(out);
}

/** 安全渲染：出错时在屏幕上显示错误信息而非空白 */
function safeRender(selectedIndex, scheme, kagentDir, workspaceRoot) {
  try {
    render(selectedIndex, scheme, kagentDir, workspaceRoot);
  } catch (err) {
    process.stdout.write(
      ANSI.clear + ANSI.home + ANSI.cursorShow +
      ANSI.red + "KAgent TUI 渲染错误: " + ANSI.reset + err.message + "\n" +
      ANSI.dim + err.stack + ANSI.reset + "\n"
    );
  }
}

// ─── TUI 状态持久化 ───────────────────────────────────────────────────
function loadTuiState(kagentDir) {
  try {
    const filePath = path.join(kagentDir, "tui-state.json");
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {}
  return { selectedIndex: 0, scheme: "cn" };
}

function saveTuiState(kagentDir, state) {
  try {
    fs.writeFileSync(
      path.join(kagentDir, "tui-state.json"),
      JSON.stringify(state, null, 2),
      "utf8"
    );
  } catch {}
}

// ─── 主循环 ──────────────────────────────────────────────────────────
function main() {
  const rootArg = process.argv[2];
  const workspaceRoot = path.resolve(rootArg || process.cwd());
  const kagentDir = path.join(workspaceRoot, ".kagent");

  if (!fs.existsSync(kagentDir)) {
    fs.mkdirSync(kagentDir, { recursive: true });
  }

  const saved = loadTuiState(kagentDir);
  let selectedIndex = saved.selectedIndex ?? 0;
  let scheme = saved.scheme ?? "cn";
  let running = true;

  function getSymbols() {
    const events = readEvents(kagentDir);
    const symbolsDoc = readSymbols(kagentDir);
    return buildSymbolList(events, symbolsDoc, workspaceRoot);
  }

  // 确保 selectedIndex 不越界
  const initialList = getSymbols();
  if (selectedIndex >= initialList.length) selectedIndex = 0;

  // 初始渲染
  safeRender(selectedIndex, scheme, kagentDir, workspaceRoot);

  function persistState() {
    saveTuiState(kagentDir, { selectedIndex, scheme });
  }

  function handleKey(ch) {
    if (ch === "q" || ch === "\x03") {
      running = false;
      persistState();
      cleanup();
      return;
    }
    if (ch === "j" || ch === "\x1b[B") {
      const list = getSymbols();
      if (selectedIndex < list.length - 1) selectedIndex++;
    }
    if (ch === "k" || ch === "\x1b[A") {
      if (selectedIndex > 0) selectedIndex--;
    }
    if (ch === "s") {
      scheme = scheme === "cn" ? "us" : "cn";
    }
    if (running) {
      safeRender(selectedIndex, scheme, kagentDir, workspaceRoot);
    }
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (data) => {
    handleKey(process.stdin.isTTY ? data.toString() : data.toString().trim());
  });

  let debounceTimer = null;
  try {
    fs.watch(kagentDir, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (running) {
          safeRender(selectedIndex, scheme, kagentDir, workspaceRoot);
        }
      }, 150);
    });
  } catch {}

  process.stdout.on("resize", () => {
    if (running) {
      safeRender(selectedIndex, scheme, kagentDir, workspaceRoot);
    }
  });

  function cleanup() {
    process.stdout.write(ANSI.cursorShow + ANSI.reset + ANSI.clear + ANSI.home);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.exit(0);
  }

  process.on("SIGINT", () => { persistState(); cleanup(); });
  process.on("SIGTERM", () => { persistState(); cleanup(); });
}

try {
  main();
} catch (err) {
  console.error("KAgent TUI 致命错误:", err.message);
  console.error(err.stack);
  process.exit(1);
}
