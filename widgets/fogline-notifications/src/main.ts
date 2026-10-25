import { invoke, subscribe, SeelenCommand, SeelenEvent, Widget } from "@seelen-ui/lib";
import { currentMonitor } from "@tauri-apps/api/window";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Alignment, ToastActionActivationType, type AppNotification, type ToastBindingChild, type ToastImage } from "@seelen-ui/lib/types";
import { el, svg, GLYPH, openTarget, refreshWhenVisible } from "../../shared/ui.ts";
import { setDnd, syncDnd } from "../../fogline-cc/src/display.ts";
import "./style.css";
import { t, locale } from "../../shared/i18n.ts";

// Notification Centre in the manner of macOS: no panel behind, notifications from one app stacked
// into a single card until clicked, every action (reply, buttons, dismiss, Do Not Disturb) handled in place.
const widget = Widget.self, root = document.getElementById("root")!;
let notifications: AppNotification[] = [], dnd: boolean | null = null, error = "", busy = false;
const expanded = new Set<string>();
const activationFailed = new Set<number>();
const replyDrafts = new Map<number, Record<string, string>>();
const CLOSE = "M6 6l12 12M18 6 6 18";

function run(action: () => unknown) {
  return async () => {
    if (busy) return;
    busy = true;
    render();
    try { await action(); error = ""; }
    catch (e) { error = String(e); }
    finally { busy = false; render(); }
  };
}
let dndRefresh: Promise<void> | null = null;
function refreshDnd(): Promise<void> {
  if (!dndRefresh) dndRefresh = (async () => {
    try { dnd = await syncDnd(); } catch { dnd = null; }
    render();
  })().finally(() => { dndRefresh = null; });
  return dndRefresh;
}
function button(cls: string, label: string, action: () => unknown, glyph?: string) {
  const b = el("button", cls, glyph ? undefined : label); b.disabled = busy;
  if (glyph) { b.append(svg(glyph, 12, 2.4)); b.setAttribute("aria-label", label); b.title = label; }
  b.addEventListener("click", e => { e.stopPropagation(); run(action)(); });
  return b;
}
async function position() {
  const monitor = await currentMonitor();
  if (!monitor) return;
  // Native coordinates are physical pixels; CSS dimensions are logical pixels.
  root.style.setProperty("--fn-available-height", `${Math.max(1, monitor.size.height / monitor.scaleFactor - 26 - 8)}px`);
  await widget.adjustAndSetPosition(monitor.position.x + monitor.size.width - Math.round(4 * monitor.scaleFactor), monitor.position.y + Math.round(26 * monitor.scaleFactor), Alignment.End, Alignment.Start);
}
function imageUrl(src: string) {
  if (/^(https?|data):/i.test(src)) return src;
  const path = src.replace(/^file:\/\/\/?/i, "");
  if (!/^[a-z]:[\\/]/i.test(path)) return "";
  try { return convertFileSrc(/^file:/i.test(src) ? decodeURIComponent(path) : path); }
  catch { return ""; }
}
function collect(entries: ToastBindingChild[], texts: string[], images: ToastImage[]) {
  for (const entry of entries) {
    if ("text" in entry) { if (entry.text.$value) texts.push(entry.text.$value); }
    else if ("image" in entry) images.push(entry.image);
    else if ("group" in entry) for (const group of entry.group.subgroup) collect(group.$value, texts, images);
  }
}
function logo(n: AppNotification, images: ToastImage[]) {
  const image = images.find(i => i["@placement"] === "AppLogoOverride"), url = image ? imageUrl(image["@src"]) : "";
  if (url) { const img = el("img", "fn-logo"); img.alt = ""; img.src = url; img.addEventListener("error", () => img.replaceWith(initial(n))); return img; }
  return initial(n);
}
function initial(n: AppNotification) {
  return el("span", "fn-logo fn-logo-text", [...(n.appName || "?").trim()][0]?.toUpperCase() ?? "?");
}
function time(date: number) {
  const d = new Date(date), mins = Math.round((Date.now() - date) / 60000);
  const stamp = el("time", "fn-time", mins < 1 ? t("現在") : mins < 60 ? t("{n} 分鐘前", { n: mins }) : d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(locale, { month: "numeric", day: "numeric" }));
  stamp.dateTime = d.toISOString(); return stamp;
}
function card(n: AppNotification, stack = 0, onClick?: () => void) {
  const texts: string[] = [], images: ToastImage[] = [];
  collect(n.content.visual.binding.$value, texts, images);
  const article = el("article", "fn-card fn-glass" + (stack ? " stacked" : "") + (activationFailed.has(n.id) ? " fn-expanded" : ""));
  if (stack > 1) article.dataset.depth = String(Math.min(stack - 1, 2));
  article.append(button("fn-close", t("關閉 {app} 通知", { app: n.appName }), () => invoke(SeelenCommand.NotificationsClose, { id: n.id }), CLOSE));
  const inputData = replyDrafts.get(n.id) ?? {};
  replyDrafts.set(n.id, inputData);
  const activate = (args: string, activationType = n.content["@activationType"]) => invoke(SeelenCommand.ActivateNotification, { id: n.id, umid: n.appUmid, args, activationType: activationType ?? ToastActionActivationType.Foreground, inputData });
  const main = el("button", "fn-main"); main.disabled = busy;
  main.addEventListener("click", onClick ?? run(async () => {
    try { await activate(n.content["@launch"] ?? ""); activationFailed.delete(n.id); }
    catch (cause) {
      console.warn("Windows notification activation failed", cause);
      activationFailed.add(n.id);
    }
  }));
  const body = el("div", "fn-body"), head = el("div", "fn-head");
  head.append(el("span", "fn-app", n.appName), time(n.date)); body.append(head);
  body.append(el("p", "fn-title", texts[0] ?? t("開啟通知")));
  for (const t of texts.slice(1)) body.append(el("p", "fn-text", t));
  if (stack > 1) body.append(el("p", "fn-more", t("還有 {n} 則通知", { n: stack - 1 })));
  main.append(logo(n, images), body);
  const hero = images.find(i => i["@placement"] === "Hero"), heroUrl = hero ? imageUrl(hero["@src"]) : "";
  if (heroUrl && !stack) { const img = el("img", "fn-hero"); img.alt = hero!["@alt"] ?? ""; img.src = heroUrl; img.addEventListener("error", () => img.remove()); body.append(img); }
  article.append(main);
  if (stack) return article;
  if (activationFailed.has(n.id)) {
    const note = el("div", "fn-activation-note"); note.setAttribute("role", "status");
    note.append(el("p", "", t("此通知無法從第三方面板開啟。完整內容已展開，請回到原程式處理。")));
    article.append(note);
  }
  const actions = el("div", "fn-actions");
  for (const entry of n.content.actions?.$value ?? []) {
    if ("action" in entry) actions.append(button("fn-button", entry.action["@content"], () => activate(entry.action["@arguments"], entry.action["@activationType"])));
    else {
      const data = entry.input;
      const control = data["@type"] === "Selection" ? el("select", "fn-input") : el("input", "fn-input");
      control.setAttribute("aria-label", data["@title"] ?? data["@placeHolderContent"] ?? t("回覆"));
      if (control instanceof HTMLInputElement) {
        control.placeholder = data["@placeHolderContent"] ?? t("回覆…");
        // Enter sends with the first action, as replying from a macOS banner does
        control.addEventListener("keydown", e => { const first = n.content.actions?.$value.find(a => "action" in a); if (!e.isComposing && e.keyCode !== 229 && e.key === "Enter" && first && "action" in first) run(() => activate(first.action["@arguments"], first.action["@activationType"]))(); });
      }
      else for (const selection of data.selection) { const option = el("option", "", selection["@content"]); option.value = selection["@id"]; control.append(option); }
      control.value = inputData[data["@id"]] ?? control.value;
      inputData[data["@id"]] = control.value;
      control.addEventListener("input", () => { inputData[data["@id"]] = control.value; });
      control.addEventListener("change", () => { inputData[data["@id"]] = control.value; });
      actions.append(control);
    }
  }
  if (actions.childElementCount) article.append(actions);
  return article;
}
function render() {
  if (document.hidden && root.childElementCount) return;
  const scrollTop = root.querySelector(".fn-list")?.scrollTop ?? 0;
  const box = el("section", "fn-box");
  const header = el("header", "fn-header fn-glass");
  header.append(el("h1", "", t("通知中心")), el("span", "fn-count", notifications.length ? String(notifications.length) : ""));
  const focus = button("fn-icon", dnd ? t("關閉勿擾") : t("開啟勿擾"), async () => { dnd = await setDnd(!dnd); }, GLYPH.moon);
  focus.disabled = busy || dnd === null;
  if (dnd !== null) focus.setAttribute("aria-pressed", String(dnd));
  else focus.title = t("無法讀取 Windows 勿擾狀態");
  const clear = button("fn-icon", t("全部清除"), () => invoke(SeelenCommand.NotificationsCloseAll), CLOSE); clear.disabled = busy || !notifications.length;
  const settings = button("fn-icon", t("通知設定"), () => openTarget("ms-settings:notifications"), GLYPH.gear);
  header.append(focus, clear, settings); box.append(header);
  if (dnd) { const note = el("div", "fn-dnd fn-glass"); note.append(svg(GLYPH.moon, 14), el("span", "", t("勿擾模式已開啟，只顯示優先通知"))); box.append(note); }

  const list = el("div", "fn-list");
  const groups = new Map<string, AppNotification[]>();
  for (const n of [...notifications].sort((a, b) => b.date - a.date)) {
    const key = n.appUmid || n.appName;
    const group = groups.get(key);
    if (group) group.push(n);
    else groups.set(key, [n]);
  }
  for (const [key, items] of groups) {
    if (items.length === 1) { list.append(card(items[0]!)); continue; }
    if (!expanded.has(key)) { list.append(card(items[0]!, items.length, () => { expanded.add(key); render(); })); continue; }
    const head = el("div", "fn-group-head");
    head.append(el("span", "fn-group-name", items[0]!.appName),
      button("fn-pill", t("顯示較少"), () => { expanded.delete(key); }),
      button("fn-pill fn-pill-icon", t("清除 {app} 的通知", { app: items[0]!.appName }), () => Promise.all(items.map(n => invoke(SeelenCommand.NotificationsClose, { id: n.id }))), CLOSE));
    list.append(head, ...items.map(n => card(n)));
  }
  if (!notifications.length) {
    const empty = el("div", "fn-empty fn-glass"); empty.append(svg("M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4", 26), el("p", "", t("沒有通知"))); list.append(empty);
  }
  box.append(list);
  if (error) { const message = el("p", "fn-error fn-glass", error); message.setAttribute("role", "status"); box.append(message); }
  root.replaceChildren(box);
  list.scrollTop = scrollTop;
}
await widget.init({ autoSizeByContent: root });
await widget.window.setTitle("@hsuan/fogline-notifications").catch(console.error);
subscribe(SeelenEvent.Notifications, (e) => { notifications = e.payload; for (const id of activationFailed) if (!notifications.some(n => n.id === id)) activationFailed.delete(id); for (const id of replyDrafts.keys()) if (!notifications.some(n => n.id === id)) replyDrafts.delete(id); for (const key of expanded) if (!notifications.some(n => (n.appUmid || n.appName) === key)) expanded.delete(key); render(); }).catch(console.error);
subscribe(SeelenEvent.NotificationsModeChanged, () => { refreshDnd(); }).catch(console.error);
async function refresh() {
  await position();
  try { notifications = await invoke(SeelenCommand.GetNotifications); error = ""; }
  catch (e) { error = String(e); }
  render();
  await refreshDnd();
}
await refresh();
widget.onTrigger(() => { expanded.clear(); refresh().catch(console.error); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") widget.hide(); });
await widget.ready();
refreshWhenVisible(render);
