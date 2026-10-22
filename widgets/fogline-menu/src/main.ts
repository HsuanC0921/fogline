import { openTarget } from "../../shared/ui.ts";
import { invoke, SeelenCommand, Widget } from "@seelen-ui/lib";
import type { WidgetId } from "@seelen-ui/lib/types";
import { t } from "../../shared/i18n.ts";

type Entry = { label: string; hint?: string; run: () => void; confirm?: string } | "-";

const open = openTarget;

const entries: Entry[] = [
  { label: t("關於這台電腦"), run: () => open("ms-settings:about") },
  "-",
  { label: t("系統設定⋯"), run: () => open("ms-settings:") },
  { label: t("Seelen 設定⋯"), run: () => invoke(SeelenCommand.TriggerWidget, { payload: { id: "@seelen/settings" as WidgetId } }) },
  { label: "Microsoft Store⋯", run: () => open("ms-windows-store:") },
  { label: t("強制結束⋯"), hint: "Ctrl ⇧ Esc", run: () => open("Taskmgr.exe") },
  "-",
  { label: t("睡眠"), run: () => invoke(SeelenCommand.Suspend) },
  { label: t("重新啟動⋯"), confirm: t("再按一次以重新啟動"), run: () => invoke(SeelenCommand.Restart) },
  { label: t("關機⋯"), confirm: t("再按一次以關機"), run: () => invoke(SeelenCommand.Shutdown) },
  "-",
  { label: t("鎖定螢幕"), hint: "Win L", run: () => invoke(SeelenCommand.Lock) },
  { label: t("登出⋯"), confirm: t("再按一次以登出"), run: () => invoke(SeelenCommand.LogOut) },
];

const widget = Widget.self;
const root = document.getElementById("root")!;
const menu = document.createElement("div");
menu.className = "slu-std-popover fm-menu";
menu.setAttribute("role", "menu");
root.append(menu);

for (const entry of entries) {
  if (entry === "-") {
    const hr = document.createElement("div");
    hr.className = "fm-sep";
    menu.append(hr);
    continue;
  }
  const btn = document.createElement("button");
  btn.className = "fm-item";
  btn.setAttribute("role", "menuitem");
  const label = document.createElement("span");
  label.textContent = entry.label;
  btn.append(label);
  if (entry.hint) {
    const hint = document.createElement("span");
    hint.className = "fm-hint";
    hint.textContent = entry.hint;
    btn.append(hint);
  }
  const reset = () => {
    btn.classList.remove("armed");
    label.textContent = entry.label;
  };
  btn.addEventListener("click", () => {
    if (entry.confirm && !btn.classList.contains("armed")) {
      btn.classList.add("armed");
      label.textContent = entry.confirm;
      return;
    }
    widget.window.hide();
    entry.run();
  });
  btn.addEventListener("mouseleave", reset);
  btn.addEventListener("blur", reset);
  menu.append(btn);
}

await widget.init({ autoSizeByContent: root });
await widget.window.setTitle("@hsuan/fogline-menu").catch(console.error);
await widget.ready();
