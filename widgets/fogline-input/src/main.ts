import { invoke, SeelenCommand, SeelenEvent, subscribe, Widget } from "@seelen-ui/lib";
import { getInputState, setInputMode, setInputWidth, showLanguageBar, syncDnd, type InputState } from "../../fogline-cc/src/display.ts";
import { el, GLYPH, closeOnEscape, safe, svg, settingsLink, openTarget } from "../../shared/ui.ts";
import type { ImeState, SystemLanguage } from "@seelen-ui/lib/types";
import "./style.css";
import { t } from "../../shared/i18n.ts";

const widget = Widget.self;
const root = document.getElementById("root")!;

const open = openTarget;
const go = (uri: string) => () => { widget.hide(); open(uri); };

function modeText(ime: ImeState | null, code: string): string {
  if (!ime) return "";
  const parts: string[] = [];
  if (code.startsWith("ja")) parts.push(!ime.native ? t("直接輸入") : ime.katakana ? t("片假名") : t("平假名"));
  else if (code.startsWith("ko")) parts.push(ime.native ? t("韓文") : t("英文"));
  else if (code.startsWith("zh")) parts.push(ime.native ? t("中文") : t("英文"));
  else parts.push(ime.native ? t("原生輸入") : t("直接輸入"));
  if (ime.fullShape) parts.push(t("全形"));
  return parts.join(" · ");
}

// the modes the active language can switch between, each one a mode to switch to
function modes(code: string, ime: ImeState | null, nativeName: string): Array<{ glyph: string; label: string; on: boolean; target: "native" | "direct" }> | null {
  if (code.startsWith("zh")) return [
    { glyph: "中", label: t("中文"), on: ime?.native === true, target: "native" },
    { glyph: "英", label: t("英文"), on: ime?.native === false, target: "direct" },
  ];
  if (code.startsWith("ja")) return [
    { glyph: "あ", label: t("ひらがな"), on: ime?.native === true, target: "native" },
    { glyph: "A", label: t("英數"), on: ime?.native === false, target: "direct" },
  ];
  if (code.startsWith("ko")) return [
    { glyph: "한", label: t("韓文"), on: ime?.native === true, target: "native" },
    { glyph: "A", label: t("英文"), on: ime?.native === false, target: "direct" },
  ];
  // any other input method that reports a native/direct state (Vietnamese, Thai, Hindi IMEs, third-party IMEs...)
  if (!ime) return null;
  return [
    { glyph: badge(code, "", nativeName), label: nativeName || t("原生輸入"), on: ime.native === true, target: "native" },
    { glyph: "A", label: t("直接輸入"), on: ime.native === false, target: "direct" },
  ];
}

// the badge macOS shows for an input source
function badge(code: string, layout: string, nativeName = ""): string {
  if (code.startsWith("zh")) return /倉頡|cangjie/i.test(layout) ? "倉" : /速成|quick/i.test(layout) ? "速" : /拼音|pinyin/i.test(layout) ? "拼" : /五筆|wubi/i.test(layout) ? "五" : /注音|bopomofo|zhuyin/i.test(layout) ? "注" : /簡|simplified|zh-cn|zh-sg/i.test(`${layout} ${code}`) ? "拼" : "注";
  if (code.startsWith("ja")) return "あ";
  if (code.startsWith("ko")) return "한";
  if (code.startsWith("en")) return "A";
  // other scripts: the first letter of the language's own name (Русский → Р, ไทย → ไ); Latin scripts: the language code
  const first = [...nativeName.trim()][0] ?? "";
  return first && !/[A-Za-z]/.test(first) ? first : code.slice(0, 2).toUpperCase();
}
// one menu row: badge, label, check mark at the end like the macOS input menu
function row(glyph: string, label: string, sub: string | null, on: boolean, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const r = el("button", "mx-row" + (on ? " on" : ""));
  r.append(el("span", "fi-badge", glyph));
  const text = el("span", "mx-text");
  text.append(el("span", "mx-name", label));
  if (sub) text.append(el("span", "mx-sub", sub));
  const check = el("span", "mx-check");
  if (on) check.append(svg(GLYPH.check, 14, 2.4));
  r.append(text, check);
  r.disabled = disabled;
  r.setAttribute("aria-pressed", String(on));
  r.addEventListener("click", () => { if (!on) onClick(); });
  return r;
}

// While the panel has focus the system reports the panel's own IME state, so only states seen
// while another window was focused are kept; those describe the app the user is typing in.
let appIme: ImeState | null = null;
let appLangs: SystemLanguage[] | null = null;
let inputState: InputState | null = null;
let switching = false;
let inputError = "";
let lastLanguage: SystemLanguage | undefined;
let renderVersion = 0;
let lastLanguageCode = "";
const unsupportedWidths = new Set<string>();
function friendlyError(error: unknown): string {
  const message = String(error);
  if (message.includes("does not support direct")) return t("這個輸入法未提供直接切換介面，請開啟語言列操作。");
  if (message.includes("Typing target changed")) return t("輸入視窗已切換，請回到原程式後重試。");
  if (message.includes("did not respond")) return t("輸入法暫時未回應，請使用語言列。");
  return message.replace(/^Error: /, "");
}
async function refreshInput() {
  try {
    inputState = await getInputState();
    if (inputState.available) {
      appIme = { ...appIme, native: inputState.native!, fullShape: inputState.fullShape!, katakana: inputState.katakana! } as ImeState;
    }
    inputError = "";
  } catch (error) { inputState = null; inputError = String(error); }
  render();
}
async function attempt(fn: () => Promise<unknown>, onError?: (error: unknown) => void) {
  switching = true; render();
  try { await fn(); await refreshInput(); }
  catch (error) { inputError = friendlyError(error); onError?.(error); }
  finally { switching = false; render(); }
}

async function render() {
  const version = ++renderVersion;
  const [languages, ime] = await Promise.all([
    appLangs ? Promise.resolve(appLangs) : safe(invoke(SeelenCommand.SystemGetLanguages) as Promise<SystemLanguage[]>, []),
    appIme ? Promise.resolve(appIme) : safe(invoke(SeelenCommand.SystemGetImeState) as Promise<ImeState>, null),
  ]);
  if (version !== renderVersion) return;
  const activeLang = (inputState?.languageCode ? languages.find((l) => l.code.toLowerCase().startsWith(inputState!.languageCode!)) : undefined)
    ?? languages.find((l) => l.keyboardLayouts.some((k) => k.active)) ?? lastLanguage;
  if (activeLang) lastLanguage = activeLang;
  const code = (inputState?.languageCode ?? activeLang?.code ?? lastLanguageCode).toLowerCase();
  if (code) lastLanguageCode = code;
  const ready = !!inputState?.available;

  const box = el("div", "slu-std-popover mx-box");
  const head = el("div", "mx-head");
  head.append(el("span", "mx-title", t("輸入法")), el("span", "mx-head-sub", ready ? modeText(ime, code) : t("讀取狀態中…")));
  box.append(head);

  const options = modes(code, ready ? ime : null, activeLang?.nativeName ?? "");
  if (options) {
    box.append(el("div", "mx-sep"), el("div", "mx-section", t("輸入模式")));
    for (const m of options) box.append(row(m.glyph, m.label, null, m.on, switching || !ready, () => attempt(() => setInputMode(m.target === "native"))));
    const widthBlocked = switching || !ready || unsupportedWidths.has(code);
    box.append(el("div", "mx-section", t("字元寬度")));
    for (const full of [false, true]) {
      box.append(row(full ? "全" : "半", full ? t("全形") : t("半形"), null, ready && inputState!.fullShape === full, widthBlocked,
        () => attempt(() => setInputWidth(full), (error) => { if (String(error).includes("does not support direct")) unsupportedWidths.add(code); })));
    }
  }

  box.append(el("div", "mx-sep"), el("div", "mx-section", t("輸入來源")));
  for (const lang of languages) {
    for (const layout of lang.keyboardLayouts) {
      const active = inputState?.languageCode ? lang === activeLang && (layout.active || lang.keyboardLayouts.length === 1) : layout.active;
      box.append(row(badge(lang.code.toLowerCase(), layout.displayName, lang.nativeName), lang.nativeName, layout.displayName, active, switching, () => attempt(async () => {
        await invoke(SeelenCommand.SystemSetKeyboardLayout, { id: layout.id, handle: layout.handle });
        appLangs = await invoke(SeelenCommand.SystemGetLanguages) as SystemLanguage[];
      })));
    }
  }

  if (inputError) { const error = el("div", "mx-note", inputError); error.setAttribute("role", "status"); box.append(error); }
  box.append(el("div", "mx-sep"));
  box.append(settingsLink(t("顯示語言列"), async () => {
    try { await showLanguageBar(); inputError = ""; }
    catch (error) { inputError = friendlyError(error); }
    render();
  }));
  box.append(el("div", "mx-sep"));
  box.append(settingsLink(t("鍵盤與輸入設定…"), go("ms-settings:typing")));
  root.replaceChildren(box);
}

subscribe(SeelenEvent.SystemImeStateChanged, (e) => {
  if (!document.hasFocus()) appIme = e.payload;
}).catch(console.error);
subscribe(SeelenEvent.SystemLanguagesChanged, (e) => {
  if (!document.hasFocus()) appLangs = e.payload;
}).catch(console.error);
// the widget loads with Seelen (lazy: false), so this seeds the cache while no panel is open
if (!document.hasFocus()) {
  [appLangs, appIme] = await Promise.all([
    safe(invoke(SeelenCommand.SystemGetLanguages) as Promise<SystemLanguage[]>, null),
    safe(invoke(SeelenCommand.SystemGetImeState) as Promise<ImeState>, null),
  ]);
}
await widget.init({ autoSizeByContent: root });
await widget.window.setTitle("@hsuan/fogline-input").catch(console.error);
await render();
// the widget stays alive for a while after it hides, so refresh the list on every trigger
closeOnEscape(() => widget.hide());
widget.onTrigger(() => {
  refreshInput(); render();
});
// Preload the IME cache without displaying an untriggered popup at the default position.
await widget.ready({ show: false });
refreshInput();
// this widget loads with Seelen, so it also keeps the menu bar's Do Not Disturb indicator in step with Windows
syncDnd().catch(() => {});
setInterval(() => syncDnd().catch(() => {}), 120000);
