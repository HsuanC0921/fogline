import { openTarget } from "../../shared/ui.ts";
import { searchFiles, setDisplayMode, setDnd } from "../../fogline-cc/src/display.ts";
import { IconPackManager, invoke, SeelenCommand, Widget } from "@seelen-ui/lib";
import type { StartMenuItem, UserAppWindow } from "@seelen-ui/lib/types";
import { PhysicalPosition, PhysicalSize } from "@seelen-ui/lib/tauri";
import { t } from "../../shared/i18n.ts";

// Fogline Lantern: Spotlight for Seelen. One index only: the Start Menu list Seelen already keeps, the window list it
// already keeps, and Windows' own search index for files. Nothing is cached here beyond a small launch counter, and the
// widget is lazy, so the webview only exists while the box is in use.
const MAX_ROWS = 8;
const open = openTarget;

const widget = Widget.self;
const root = document.getElementById("root")!;
root.innerHTML = `<div class="slu-std-popover fs-box">
  <div class="fs-field">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input class="fs-input" spellcheck="false" autocomplete="off" />
  </div>
  <div class="fs-list" role="listbox"></div>
</div>`;
const input = root.querySelector<HTMLInputElement>(".fs-input")!;
input.placeholder = t("搜尋應用程式、視窗、檔案與設定");
const list = root.querySelector<HTMLElement>(".fs-list")!;

type Group = "top" | "app" | "window" | "file" | "setting" | "system" | "web";
type Hit = { id: string; group: Group; label: string; sub: string; run: () => void; reveal?: () => void; item?: StartMenuItem; path?: string };
const GROUP_LABEL: Record<Group, string> = {
  top: "", app: t("應用程式"), window: t("視窗"), file: t("檔案"), setting: t("設定"), system: t("系統"), web: t("網頁"),
};

let items: StartMenuItem[] = [];
let windows: UserAppWindow[] = [];
let hits: Hit[] = [];
let selected = 0;
let icons: IconPackManager | null = null;
let ticket = 0;

// ---- what was launched before: a counter per id, older launches count for less ----
const USE_KEY = "fogline-lantern-use";
type Use = Record<string, { n: number; t: number }>;
function loadUse(): Use { try { return JSON.parse(localStorage.getItem(USE_KEY) || "{}"); } catch { return {}; } }
function bump(id: string) {
  try {
    const use = loadUse();
    const now = Date.now();
    use[id] = { n: (use[id]?.n ?? 0) + 1, t: now };
    const keep = Object.entries(use).sort((a, b) => b[1].t - a[1].t).slice(0, 200);
    localStorage.setItem(USE_KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* storage unavailable: ranking just stays text-only */ }
}
function boost(id: string, use: Use): number {
  const u = use[id];
  if (!u) return 0;
  const days = (Date.now() - u.t) / 864e5;
  return Math.min(25, u.n * 4) * Math.max(0.25, 1 - days / 60);
}

// prefix beats word start beats substring beats scattered letters; 0 means no match
function score(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 110;
  if (n.startsWith(q)) return 100 - n.length / 100;
  const i = n.indexOf(q);
  if (i >= 0) return (/[\s\-_.(]/.test(n[i - 1] ?? "") ? 80 : 60) - i / 100;
  let at = 0;
  for (const c of q) {
    at = n.indexOf(c, at) + 1;
    if (at === 0) return 0;
  }
  return 20;
}

// ---- calculator: numbers, operators and a short list of functions only; nothing else reaches Function ----
const FN: Record<string, string> = {
  sqrt: "Math.sqrt", sin: "Math.sin", cos: "Math.cos", tan: "Math.tan", ln: "Math.log", log: "Math.log10",
  abs: "Math.abs", round: "Math.round", floor: "Math.floor", ceil: "Math.ceil", pi: "Math.PI", e: "Math.E",
};
function calc(q: string): string | null {
  const s = q.toLowerCase().replace(/[x×]/g, "*").replace(/÷/g, "/").replace(/\^/g, "**").replace(/,/g, "");
  if (!/^[\d\s+\-*/().%a-z]+$/.test(s)) return null;
  let bad = false;
  const expr = s.replace(/[a-z]+/g, (w) => (FN[w] ? FN[w] : ((bad = true), w)));
  if (bad || !/[+\-*/%]|Math\.[a-z0-9]+\(/i.test(expr.replace(/^\s*-/, ""))) return null;
  try {
    const v = Function(`"use strict"; return (${expr})`)();
    return typeof v === "number" && Number.isFinite(v) ? String(+v.toPrecision(12)) : null;
  } catch {
    return null;
  }
}

// ---- unit conversion: "10 km to mi", "5kg in lb", "20c to f" ----
const UNITS: Record<string, [string, number]> = {
  mm: ["len", 0.001], cm: ["len", 0.01], m: ["len", 1], km: ["len", 1000], in: ["len", 0.0254], ft: ["len", 0.3048], yd: ["len", 0.9144], mi: ["len", 1609.344],
  g: ["mass", 1], kg: ["mass", 1000], oz: ["mass", 28.349523], lb: ["mass", 453.59237],
  ml: ["vol", 0.001], l: ["vol", 1], gal: ["vol", 3.785411784], floz: ["vol", 0.0295735],
  kb: ["data", 1e3], mb: ["data", 1e6], gb: ["data", 1e9], tb: ["data", 1e12], kib: ["data", 1024], mib: ["data", 1048576], gib: ["data", 1073741824],
  c: ["temp", 0], f: ["temp", 0], k: ["temp", 0],
};
function convert(q: string): string | null {
  const m = q.toLowerCase().match(/^(-?[\d.]+)\s*°?([a-z]+)\s+(?:to|in|=|轉|換成)\s*°?([a-z]+)$/);
  if (!m) return null;
  const v = parseFloat(m[1]), from = UNITS[m[2]], to = UNITS[m[3]];
  if (!from || !to || from[0] !== to[0] || Number.isNaN(v)) return null;
  let out: number;
  if (from[0] === "temp") {
    const c = m[2] === "c" ? v : m[2] === "f" ? (v - 32) / 1.8 : v - 273.15;
    out = m[3] === "c" ? c : m[3] === "f" ? c * 1.8 + 32 : c + 273.15;
  } else out = (v * from[1]) / to[1];
  return `${+out.toPrecision(8)} ${m[3]}`;
}

// ---- Settings pages and power actions ----
const SETTINGS: [string, string, string][] = [
  [t("Wi-Fi"), "ms-settings:network-wifi", "wifi wlan 網路 network"],
  [t("藍牙與裝置"), "ms-settings:bluetooth", "bluetooth 藍牙 devices"],
  [t("顯示器"), "ms-settings:display", "display 螢幕 解析度 亮度 hdr"],
  [t("音效"), "ms-settings:sound", "sound 音量 喇叭 麥克風 audio"],
  [t("通知"), "ms-settings:notifications", "notifications 勿擾 focus"],
  [t("個人化"), "ms-settings:personalization", "personalization 桌布 主題 色彩 深色"],
  [t("應用程式與功能"), "ms-settings:appsfeatures", "apps 解除安裝 uninstall"],
  [t("預設應用程式"), "ms-settings:defaultapps", "default 預設"],
  [t("電源與電池"), "ms-settings:powersleep", "power battery 電池 睡眠"],
  [t("儲存空間"), "ms-settings:storagesense", "storage 磁碟 清理"],
  [t("時間與語言"), "ms-settings:dateandtime", "time date 日期 時間 語言 language"],
  [t("輸入"), "ms-settings:typing", "keyboard 鍵盤 輸入法 input"],
  [t("隱私權與安全性"), "ms-settings:privacy", "privacy 隱私 security"],
  [t("Windows Update"), "ms-settings:windowsupdate", "update 更新"],
];
const SYSTEM: [string, string, () => unknown, string][] = [
  [t("鎖定螢幕"), "lock", () => invoke(SeelenCommand.Lock), "lock 鎖定"],
  [t("睡眠"), "sleep", () => invoke(SeelenCommand.Suspend), "sleep suspend 睡眠"],
  [t("重新啟動"), "restart", () => invoke(SeelenCommand.Restart), "restart reboot 重新啟動 重開"],
  [t("關機"), "shutdown", () => invoke(SeelenCommand.Shutdown), "shutdown power off 關機"],
  [t("登出"), "logout", () => invoke(SeelenCommand.LogOut), "logout sign out 登出"],
  [t("工作管理員"), "taskmgr", () => open("Taskmgr.exe"), "task manager 工作管理員 強制結束"],
  [t("資源回收筒"), "bin", () => open("shell:RecycleBinFolder"), "recycle bin 回收筒"],
  [t("深色模式"), "dark", () => setDisplayMode("theme", true), "dark mode 深色 暗色 夜間"],
  [t("淺色模式"), "light", () => setDisplayMode("theme", false), "light mode 淺色 亮色"],
  [t("開啟護眼模式"), "warm-on", () => setDisplayMode("warm", true), "night light warm eye 護眼 暖色"],
  [t("關閉護眼模式"), "warm-off", () => setDisplayMode("warm", false), "night light warm eye 護眼 暖色"],
  [t("開啟勿擾"), "dnd-on", () => setDnd(true), "do not disturb focus 勿擾 專注"],
  [t("關閉勿擾"), "dnd-off", () => setDnd(false), "do not disturb focus 勿擾 專注"],
];
const WEB: [string, string, string][] = [
  ["yt", "YouTube", "https://www.youtube.com/results?search_query="],
  ["gh", "GitHub", "https://github.com/search?q="],
  ["wiki", "Wikipedia", "https://zh.wikipedia.org/w/index.php?search="],
  ["map", "Google Maps", "https://www.google.com/maps/search/"],
  ["g", "Google", "https://www.google.com/search?q="],
];

// ---- small Flow/Spotlight extras that need no index: "> cmd", "quit app", a path, a colour, "uuid" ----
function hex2rgb(h: string): [number, number, number] {
  const v = parseInt(h.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function extraHits(q: string): Hit[] {
  const out: Hit[] = [];
  const copy = (text: string) => () => navigator.clipboard.writeText(text);
  if (q.startsWith(">") && q.slice(1).trim()) {
    const cmd = q.slice(1).trim();
    out.push({ id: "cmd", group: "top", label: t("執行：{q}", { q: cmd }), sub: t("命令提示字元"), run: () => invoke(SeelenCommand.Run, { program: "cmd.exe", args: ["/k", cmd], workingDir: null, elevated: false }) });
  }
  const quit = q.match(/^(?:quit|kill|close|結束|關閉)\s+(.+)$/i);
  if (quit) {
    const name = quit[1].toLowerCase();
    for (const w of windows.filter((w) => score(w.appName, name) > 0 || score(w.title, name) > 0).slice(0, 3)) {
      out.push({ id: "quit:" + w.hwnd, group: "top", label: t("結束 {name}", { name: w.title || w.appName }), sub: w.appName, run: () => invoke(SeelenCommand.WegCloseApp, { hwnd: w.hwnd }) });
    }
  }
  if (/^([a-z]:[\\/]|\\\\|~[\\/]|%[\w]+%)/i.test(q)) {
    const path = q.replace(/^~/, "%USERPROFILE%");
    out.push({ id: "path", group: "top", label: path, sub: t("開啟路徑"), run: () => open(path) });
  }
  if (/^#?[0-9a-f]{6}$/i.test(q)) {
    const [r, g, b] = hex2rgb(q);
    out.push({ id: "color", group: "top", label: `rgb(${r}, ${g}, ${b})`, sub: t("複製顏色"), run: copy(`rgb(${r}, ${g}, ${b})`) });
  }
  if (/^(uuid|guid)$/i.test(q)) {
    const id = crypto.randomUUID();
    out.push({ id: "uuid", group: "top", label: id, sub: t("複製"), run: copy(id) });
  }
  if (/^(now|date|time|現在|日期|時間)$/i.test(q)) {
    const now = new Date().toLocaleString();
    out.push({ id: "now", group: "top", label: now, sub: t("複製"), run: copy(now) });
  }
  return out;
}

// settings and commands match on whole words or prefixes only; scattered letters would make "dis" find Bluetooth
function tight(label: string, words: string, q: string): number {
  const a = score(label, q), b = score(words, q);
  return Math.max(a >= 40 ? a : 0, b >= 60 ? b * 0.7 : 0);
}

function remember(hit: Hit): () => void {
  return () => { bump(hit.id); hit.run(); };
}

function localHits(q: string): Hit[] {
  const out: Hit[] = [];
  const use = loadUse();
  const ql = q.toLowerCase();

  out.push(...extraHits(q));
  const ans = calc(q);
  if (ans !== null) out.push({ id: "calc", group: "top", label: `= ${ans}`, sub: t("複製結果"), run: () => navigator.clipboard.writeText(ans) });
  const conv = convert(q);
  if (conv) out.push({ id: "conv", group: "top", label: `= ${conv}`, sub: t("複製結果"), run: () => navigator.clipboard.writeText(conv) });

  const apps = items
    .map((item) => ({ item, s: score(item.display_name, ql) }))
    .filter((x) => x.s > 0)
    .map((x) => ({ ...x, s: x.s + boost("app:" + x.item.display_name, use) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  for (const { item } of apps) {
    out.push({
      id: "app:" + item.display_name, group: "app", label: item.display_name, sub: t("應用程式"), item,
      run: () => open(item.umid ? `shell:AppsFolder\\${item.umid}` : item.path),
    });
  }

  const wins = windows
    .map((w) => ({ w, s: Math.max(score(w.title, ql), score(w.appName, ql) * 0.9) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3);
  for (const { w } of wins) {
    out.push({
      id: "win:" + w.appName, group: "window", label: w.title || w.appName, sub: w.appName,
      item: w.umid ? ({ path: w.process.path, umid: w.umid } as StartMenuItem) : ({ path: w.process.path, umid: null } as StartMenuItem),
      run: () => invoke(SeelenCommand.RequestFocus, { hwnd: w.hwnd }),
    });
  }

  for (const [label, uri, words] of SETTINGS) {
    const s = tight(label, words, ql);
    if (s > 0 && ql.length >= 2) out.push({ id: "set:" + uri, group: "setting", label, sub: t("設定"), run: () => open(uri), path: String(s) });
  }
  for (const [label, key, run, words] of SYSTEM) {
    const s = tight(label, words, ql);
    if (s > 0 && ql.length >= 2) out.push({ id: "sys:" + key, group: "system", label, sub: t("系統"), run: () => { run(); }, path: String(s) });
  }

  // cap each group, keep the order apps → windows → settings → system
  const rank: Group[] = ["top", "app", "window", "setting", "system", "file", "web"];
  const sorted = out.sort((a, b) => rank.indexOf(a.group) - rank.indexOf(b.group));
  const settingsAndSystem = sorted.filter((h) => h.group === "setting" || h.group === "system")
    .sort((a, b) => Number(b.path) - Number(a.path)).slice(0, 3);
  return [...sorted.filter((h) => h.group !== "setting" && h.group !== "system"), ...settingsAndSystem]
    .sort((a, b) => rank.indexOf(a.group) - rank.indexOf(b.group)).map((h) => ({ ...h, run: remember(h) }));
}

function webHits(q: string): Hit[] {
  const m = q.match(/^(\S+)\s+(.+)$/);
  const prefix = m ? WEB.find((w) => w[0] === m[1].toLowerCase()) : undefined;
  const out: Hit[] = [];
  if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(q) && !/\s/.test(q)) {
    const url = /^https?:/i.test(q) ? q : `https://${q}`;
    out.push({ id: "url", group: "web", label: t("開啟 {q}", { q }), sub: t("瀏覽器"), run: () => open(url) });
  }
  if (prefix && m) {
    out.push({ id: "web:" + prefix[0], group: "web", label: t("在 {site} 搜尋：{q}", { site: prefix[1], q: m[2] }), sub: prefix[1], run: () => open(prefix[2] + encodeURIComponent(m[2])) });
  }
  out.push({ id: "web:g", group: "web", label: t("搜尋網頁：{q}", { q }), sub: t("瀏覽器"), run: () => open(`https://www.google.com/search?q=${encodeURIComponent(q)}`) });
  return out;
}

// nothing typed: what was used most lately, like Spotlight's suggestions
function suggestions(): Hit[] {
  const use = loadUse();
  const byId = new Map(items.map((i) => ["app:" + i.display_name, i]));
  return Object.entries(use)
    .filter(([id]) => byId.has(id))
    .sort((a, b) => boost(b[0], use) - boost(a[0], use))
    .slice(0, 5)
    .map(([id]) => {
      const item = byId.get(id)!;
      return { id, group: "app" as Group, label: item.display_name, sub: t("最近使用"), item, run: remember({ id, group: "app", label: "", sub: "", run: () => open(item.umid ? `shell:AppsFolder\\${item.umid}` : item.path) }) };
    });
}

let fileTimer: ReturnType<typeof setTimeout> | undefined;
function refresh() {
  const q = input.value.trim();
  const mine = ++ticket;
  clearTimeout(fileTimer);
  if (!q) {
    hits = suggestions();
    selected = 0;
    render();
    return;
  }
  hits = [...localHits(q), ...webHits(q)];
  selected = 0;
  render();
  if (q.length < 2) return;
  // files come from Windows' own index through the helper, a moment after typing stops
  fileTimer = setTimeout(async () => {
    try {
      const found = await searchFiles(q);
      if (mine !== ticket) return;
      const files: Hit[] = found.slice(0, 4).map((f) => ({
        id: "file:" + f.path, group: "file", label: f.name, sub: f.path.replace(/\\[^\\]*$/, "") || f.path, path: f.path,
        item: { path: f.path, umid: null } as unknown as StartMenuItem,
        run: remember({ id: "file:" + f.path, group: "file", label: "", sub: "", run: () => open(f.path) }),
        reveal: () => open(f.path.replace(/\\[^\\]*$/, "")),
      }));
      const keep = hits.filter((h) => h.group !== "file");
      const at = keep.findIndex((h) => h.group === "web");
      const selectedId = hits[selected]?.id;
      hits = [...keep.slice(0, at < 0 ? keep.length : at), ...files, ...keep.slice(at < 0 ? keep.length : at)];
      selected = selected > 0 ? Math.max(0, hits.findIndex((h) => h.id === selectedId)) : 0; // keep the choice only if the user moved off the top row
      render();
    } catch { /* the helper is optional: without it the list simply has no files */ }
  }, 140);
}

function render() {
  list.replaceChildren();
  let last: Group | null = null;
  hits.forEach((hit, i) => {
    if (hit.group !== last && GROUP_LABEL[hit.group]) {
      const head = document.createElement("div");
      head.className = "fs-head";
      head.textContent = hit.sub === t("最近使用") ? t("最近使用") : GROUP_LABEL[hit.group];
      list.append(head);
    }
    last = hit.group;
    const row = document.createElement("button");
    row.className = "fs-row";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(i === selected));
    let lead: HTMLElement;
    const icon = hit.item && icons?.getIcon({ path: hit.item.path, umid: hit.item.umid });
    if (icon) {
      const img = document.createElement("img");
      img.src = icon.light || icon.dark || icon.base || "";
      lead = img;
    } else {
      lead = document.createElement("span");
      lead.className = "fs-ph";
      if (hit.item) IconPackManager.requestIconExtraction({ path: hit.item.path, umid: hit.item.umid });
    }
    const label = document.createElement("span");
    label.className = "fs-label";
    label.textContent = hit.label;
    if (hit.label.startsWith("=")) label.classList.add("fs-answer");
    const sub = document.createElement("span");
    sub.className = "fs-sub";
    sub.textContent = hit.sub;
    row.append(lead, label, sub);
    row.addEventListener("mousemove", () => { if (selected !== i) select(i); });
    row.addEventListener("click", () => activate(i));
    list.append(row);
  });
}

function select(i: number) {
  selected = i;
  list.querySelectorAll(".fs-row").forEach((r, j) => r.setAttribute("aria-selected", String(j === i)));
  list.querySelectorAll(".fs-row")[i]?.scrollIntoView({ block: "nearest" });
}

function activate(i: number, reveal = false) {
  const hit = hits[i];
  if (!hit) return;
  widget.hide();
  (reveal && hit.reveal ? hit.reveal : hit.run)();
}

input.addEventListener("input", refresh);
input.addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    select(Math.min(selected + 1, hits.length - 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    select(Math.max(selected - 1, 0));
  } else if (e.key === "Enter") {
    e.preventDefault();
    activate(selected, e.ctrlKey);
  } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c" && hits[selected]?.group === "file") {
    e.preventDefault();
    navigator.clipboard.writeText(hits[selected].path ?? "");
    widget.hide();
  } else if (e.altKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    activate(Number(e.key) - 1);
  } else if (e.key === "Escape") {
    widget.hide();
  }
});

// Spotlight sits centred in the upper part of the screen, never next to the cursor. Seelen opens popups near the
// cursor, so the window is made as large as the monitor (Seelen then clamps it to the monitor) and the panel is placed
// by CSS. Clicking the transparent area dismisses it, like clicking away from Spotlight.
async function coverMonitor() {
  const [pos, size, monitors] = await Promise.all([
    widget.window.outerPosition(),
    widget.window.outerSize(),
    invoke(SeelenCommand.SystemGetMonitors),
  ]);
  const cx = pos.x + size.width / 2;
  const cy = pos.y + size.height / 2;
  const m =
    monitors.find((m) => m.rect.left <= cx && cx < m.rect.right && m.rect.top <= cy && cy < m.rect.bottom) ??
    monitors.find((m) => m.isPrimary) ??
    monitors[0];
  if (!m) return;
  await widget.window.setPosition(new PhysicalPosition(m.rect.left, m.rect.top));
  await widget.window.setSize(new PhysicalSize(m.rect.right - m.rect.left, m.rect.bottom - m.rect.top));
}
root.addEventListener("mousedown", (e) => {
  if (e.target === root) widget.hide();
});

// the widget is lazy: the lists are fetched when it opens, and Seelen closes the whole webview again after it has been
// hidden for a while. Windows are re-read on every trigger so the list is never stale.
async function load() {
  const [apps, mgr, wins] = await Promise.all([
    invoke(SeelenCommand.GetStartMenuItems),
    icons ? Promise.resolve(icons) : IconPackManager.create(),
    invoke(SeelenCommand.GetUserAppWindows).catch(() => [] as UserAppWindow[]),
  ]);
  items = [...apps];
  icons = mgr;
  windows = [...wins].filter((w) => w.title);
  refresh();
}

await widget.init();
await coverMonitor().catch(() => {});
await widget.ready();
input.focus();
await load();

widget.onTrigger(() => {
  input.value = "";
  input.focus();
  load();
});
