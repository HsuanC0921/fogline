import { invoke, SeelenCommand } from "@seelen-ui/lib";
// Small DOM helpers shared by the Fogline panels (bundled into each widget by esbuild).

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// 24x24 stroke glyphs, drawn in the same 2px round style as the menu bar icons
export const GLYPH = {
  wifi: "M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01",
  bt: "m7 7 10 10-5 5V2l5 5L7 17",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  shot: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M9 12h6",
  cast: "M3 6h18v11H3zM8 21h8M12 17v4",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  vol: "M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  mute: "M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6",
  play: "M7 4.5v15l12-7.5z",
  pause: "M7 4h3.5v16H7zM13.5 4H17v16h-3.5z",
  prev: "M19 5v14L8.5 12zM6 5v14",
  next: "M5 5v14l10.5-7zM18 5v14",
  gear: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  lock: "M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3",
  sleep: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  power: "M12 3v9M6.3 6.8a8 8 0 1 0 11.4 0",
  restart: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  hotspot: "M13.5 12a1.5 1.5 0 1 0-3 0 1.5 1.5 0 1 0 3 0M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.7 5.7a9 9 0 0 0 0 12.6M18.3 5.7a9 9 0 0 1 0 12.6",
  focus: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  chev: "m9 6 6 6-6 6",
  left: "m15 6-6 6 6 6",
  right: "m9 6 6 6-6 6",
  check: "m5 12 5 5 9-10",
  note: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  speaker: "M7 3h10v18H7zM12 8h.01M12 15a3 3 0 1 0 0 .01",
  headphones: "M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H4zM17 14h3v5h-3z",
  wired: "M5 4h14v10H5zM9 14v3h6v-3M12 17v3M8 8h.01M12 8h.01M16 8h.01",
  keyboard: "M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8",
  mouse: "M8 3h8a3 3 0 0 1 3 3v8a7 7 0 0 1-14 0V6a3 3 0 0 1 3-3zM12 3v6",
  phone: "M8 3h8v18H8zM11 18h2",
  pad: "M6 8h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5 2l-1-1H8l-1 1a3 3 0 0 1-5-2v-1a4 4 0 0 1 4-4zM8 11v3M6.5 12.5h3M16 12h.01M18 13h.01",
  device: "M6 4h12v16H6zM10 17h4",
  appearance: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M15 4v16M18 6.5v11",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
};

// macOS-style switch; the knob is drawn by CSS from aria-checked
export function toggleSwitch(on: boolean, label: string, onChange: (v: boolean) => void): HTMLButtonElement {
  const t = el("button", "mx-switch");
  t.setAttribute("role", "switch");
  t.setAttribute("aria-checked", String(on));
  t.setAttribute("aria-label", label);
  t.addEventListener("click", () => onChange(!on));
  return t;
}

// a bottom row that opens a Settings page and closes the panel
export function settingsLink(label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "mx-link", label);
  b.addEventListener("click", onClick);
  return b;
}

export function svg(d: string, size = 18, sw = 2): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", String(sw));
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
}

// a query that never answers must not keep a panel from opening
export async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.catch(() => fallback), new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), 1500);
    })]);
  } finally { clearTimeout(timer); }
}

// Popup lifetime follows Seelen focus/owner-window tracking; pointer movement does not dismiss it.
export function closeOnEscape(hide: () => void) {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return hide();
    // Up / Down / Home / End walk the controls like a macOS menu (typing in a field keeps its own arrows)
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const items = [...document.querySelectorAll<HTMLElement>("button:not(:disabled), input, select")].filter((e) => e.offsetParent !== null);
    if (!items.length) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1);
    items[next]!.focus(); event.preventDefault();
  });
}

// Refresh data skipped while a native popup was hidden. This also handles a trigger
// arriving before the WebView has completed its asynchronous visibility change.
export function refreshWhenVisible(refresh: () => unknown): void {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) Promise.resolve().then(refresh).catch(console.error);
  });
}

// URI schemes (ms-settings:, https:, shell:) are not files: OpenFile does nothing for them, so they go through explorer.exe
export function openTarget(target: string): Promise<unknown> {
  return /^(ms-[a-z-]+:|https?:|shell:)/i.test(target)
    ? invoke(SeelenCommand.Run, { program: "explorer.exe", args: [target], workingDir: null, elevated: false })
    : invoke(SeelenCommand.OpenFile, { path: target });
}
