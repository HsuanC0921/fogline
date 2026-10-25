import { Widget, subscribe, SeelenEvent } from "@seelen-ui/lib";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { el, svg, closeOnEscape } from "../../shared/ui.ts";
import "./style.css";
import { t } from "../../shared/i18n.ts";

// Seelen 2.8.8+ separates the per-session action id from the persistent pin id.
interface TrayItem { sessionId: string; registryKey: string; tooltip: string; iconPath?: string; iconImageHash?: string; isVisible: boolean; isPromoted: boolean; guid?: string }
const widget = Widget.self, root = document.getElementById("root")!;
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const excluded = new Set(["7820ae73-23e3-4229-82c1-e41cb67d5b9c","7820ae74-23e3-4229-82c1-e41cb67d5b9c","7820ae75-23e3-4229-82c1-e41cb67d5b9c"]);
let items: TrayItem[] = [], contextOwner: number | null = null, pendingContext = false, error = "";
const pinning = new Set<string>();
async function action(item: TrayItem, action: string) {
  try { await invoke("send_system_tray_icon_action", { id: item.sessionId, action }); error = ""; }
  catch (e) { error = String(e); render(); }
}
function render() {
  const box = el("section", "slu-std-popover mx-box ftray");
  const visible = items.filter(item => item.isVisible && !excluded.has(item.guid ?? "")).sort((a,b) => collator.compare(a.tooltip,b.tooltip));
  const header = el("div", "mx-head"); header.append(el("span", "mx-title", t("背景程式")), el("span", "mx-head-sub", t("{n} 個", { n: visible.length }))); box.append(header, el("div", "mx-sep"));
  if (!visible.length) box.append(el("div", "mx-empty", t("沒有在背景執行的程式")));
  for (const item of visible) {
    const row = el("div", "mx-row hoverable ftray-row"), app = el("button", "ftray-app"); app.title = item.tooltip;
    if (item.iconPath) { const image = el("img", ""); image.alt = ""; image.src = convertFileSrc(item.iconPath) + `?hash=${item.iconImageHash ?? ""}`; app.append(image); }
    else app.append(el("span", "ftray-noicon"));
    app.append(el("span", "", item.tooltip));
    app.addEventListener("click", e => { if (e.detail !== 2) action(item, "LeftClick"); });
    app.addEventListener("dblclick", () => action(item,"LeftDoubleClick"));
    app.addEventListener("auxclick", e => { if (e.button === 1) action(item,"MiddleClick"); });
    app.addEventListener("contextmenu", e => { e.preventDefault(); pendingContext = true; contextOwner = null; action(item,"RightClick"); });
    const pin = el("button", "ftray-pin"); pin.setAttribute("aria-label", `${item.isPromoted ? t("取消釘選") : t("釘選")} ${item.tooltip}`); pin.setAttribute("aria-pressed", String(item.isPromoted)); pin.disabled = !item.registryKey || pinning.has(item.registryKey);
    pin.setAttribute("aria-busy", String(pinning.has(item.registryKey)));
    pin.append(svg("m8 3 8 0-1 6 3 3v2h-5v7l-2-3v-4H6v-2l3-3z",16));
    pin.addEventListener("click", async () => {
      if (pinning.has(item.registryKey)) return;
      pinning.add(item.registryKey); error = ""; render();
      try {
        await invoke("set_system_tray_icon_promoted", { id: item.registryKey, promoted: !item.isPromoted });
        items = await invoke<TrayItem[]>("get_system_tray_icons");
      } catch(e) { error=String(e); }
      finally { pinning.delete(item.registryKey); render(); }
    });
    row.append(app,pin); box.append(row);
  }
  if(error) box.append(el("p","mx-note",error)); root.replaceChildren(box);
}
await widget.init({ autoSizeByContent: root, hideOnFocusLoss: false });
await widget.window.setTitle("@hsuan/fogline-tray").catch(console.error);
subscribe(SeelenEvent.SystemTrayChanged, e => { items = e.payload as unknown as TrayItem[]; render(); }).catch(console.error);
subscribe(SeelenEvent.GlobalFocusChanged, e => {
  const focus = e.payload;
  if (focus.hwnd === widget.windowId || focus.ownerHwnd === widget.windowId) { pendingContext = false; contextOwner = null; return; }
  // A foreign app owns its own menu. Keep the tray through that focus transition and its submenus.
  if (pendingContext) { pendingContext = false; contextOwner = focus.hwnd; return; }
  if (focus.hwnd === contextOwner || focus.ownerHwnd === contextOwner || focus.class === "#32768") return;
  widget.window.hide();
}).catch(console.error);
async function refresh() { try { items = await invoke<TrayItem[]>("get_system_tray_icons"); error = ""; } catch(e) { error = String(e); } render(); }
await refresh(); widget.onTrigger(() => { pendingContext = false; contextOwner = null; refresh(); });
closeOnEscape(() => widget.window.hide());
await widget.ready();
