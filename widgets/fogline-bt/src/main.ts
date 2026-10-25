import { invoke, SeelenCommand, SeelenEvent, subscribe, Widget } from "@seelen-ui/lib";
import type { BluetoothDevice, DevicePairingAnswer, DevicePairingNeededAction, RadioDevice } from "@seelen-ui/lib/types";
import { el, GLYPH, safe, closeOnEscape, refreshWhenVisible, svg, toggleSwitch, settingsLink, openTarget } from "../../shared/ui.ts";
import "./style.css";
import { t } from "../../shared/i18n.ts";

const widget = Widget.self;
const root = document.getElementById("root")!;
const open = openTarget;
const go = (uri: string) => () => { widget.hide(); open(uri); };

function glyph(d: BluetoothDevice): string {
  const major = (d.class as { major: string }).major;
  if (major === "AudioVideo") return GLYPH.headphones;
  if (major === "Phone") return GLYPH.phone;
  if (major === "Peripheral") {
    const minor = JSON.stringify((d.class as { minor?: unknown }).minor ?? "");
    if (/Pointing|Mouse/i.test(minor)) return GLYPH.mouse;
    if (/Game|Joy/i.test(minor)) return GLYPH.pad;
    return GLYPH.keyboard;
  }
  return GLYPH.device;
}

let renderVersion = 0;
let radioBusy = false;
let radioError = "";
const busy = new Set<string>();

// Nearby devices are only searched for while that section is open, and for 30 seconds at most:
// a Bluetooth inquiry keeps the radio busy and costs power.
let scanning = false, scanTimer: number | undefined;
function setScanning(v: boolean) {
  if (v === scanning) return;
  clearTimeout(scanTimer);
  scanning = v;
  invoke(v ? SeelenCommand.StartBluetoothScanning : SeelenCommand.StopBluetoothScanning).catch(console.error);
  if (v) scanTimer = window.setTimeout(() => { setScanning(false); render(); }, 30000);
}
let showNearby = false;
// pairing in place: what Windows asks for comes back from the request and is answered inline
let pairing: { id: string; action: DevicePairingNeededAction } | null = null, pairError = "";
async function pair(d: BluetoothDevice) {
  busy.add(d.id); pairError = ""; render();
  try {
    const action = await invoke(SeelenCommand.RequestPairBluetoothDevice, { id: d.id });
    pairing = action.needs === "None" ? null : { id: d.id, action };
  } catch (e) { pairError = String(e); }
  busy.delete(d.id); render();
}
async function answer(id: string, accept: boolean, fields: Partial<DevicePairingAnswer> = {}) {
  busy.add(id); pairing = null; render();
  try { await invoke(SeelenCommand.ConfirmBluetoothDevicePairing, { id, answer: { accept, pin: null, username: null, password: null, address: null, ...fields } }); }
  catch (e) { pairError = String(e); }
  busy.delete(id); render();
}
function pairPrompt(id: string, action: DevicePairingNeededAction): HTMLElement {
  const box = el("div", "bt-pair");
  const actions = el("div", "bt-pair-actions");
  const inputs: Record<string, HTMLInputElement> = {};
  const field = (key: keyof DevicePairingAnswer, placeholder: string, type = "text") => {
    const i = el("input", "bt-input"); i.type = type; i.placeholder = placeholder; i.setAttribute("aria-label", placeholder);
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    inputs[key] = i; box.append(i);
  };
  const submit = () => answer(id, true, Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])));
  switch (action.needs) {
    case "ConfirmOnly": box.append(el("p", "bt-pair-text", t("要和這個裝置配對嗎？"))); break;
    case "DisplayPin": box.append(el("p", "bt-pair-text", t("在裝置上輸入這組 PIN：")), el("div", "bt-pin", action.pin)); break;
    case "ConfirmPinMatch": box.append(el("p", "bt-pair-text", t("確認裝置上顯示的 PIN 相同：")), el("div", "bt-pin", action.pin)); break;
    case "ProvidePin": box.append(el("p", "bt-pair-text", t("輸入裝置提供的 PIN"))); field("pin", "PIN"); break;
    case "ProvidePasswordCredential": box.append(el("p", "bt-pair-text", t("這個裝置需要帳號密碼"))); field("username", t("使用者名稱")); field("password", t("密碼"), "password"); break;
    case "ProvideAddress": box.append(el("p", "bt-pair-text", t("輸入裝置位址"))); field("address", t("位址")); break;
  }
  const cancel = el("button", "bt-btn", t("取消")); cancel.addEventListener("click", () => answer(id, false));
  const ok = el("button", "bt-btn primary", t("配對")); ok.addEventListener("click", submit);
  actions.append(cancel, ok); box.append(actions);
  queueMicrotask(() => Object.values(inputs)[0]?.focus());
  return box;
}
function deviceRow(d: BluetoothDevice, onClick: () => void, title: string, enabled: boolean, sub?: string): HTMLElement {
  const row = el("div", "mx-row hoverable bt-row" + (d.connected ? " on" : ""));
  const main = el("button", "bt-main");
  const ic = el("span", "mx-ico");
  ic.append(svg(glyph(d), 15));
  const text = el("span", "mx-text");
  text.append(el("span", "mx-name", d.name || t("未命名裝置")));
  if (sub) text.append(el("span", "mx-sub", sub));
  main.append(ic, text);
  main.disabled = !enabled;
  main.title = title;
  main.addEventListener("click", () => { if (enabled) onClick(); });
  row.append(main);
  return row;
}

async function render() {
  if (document.hidden && root.childElementCount) return;
  const version = ++renderVersion;
  const [radios, devices] = await Promise.all([
    safe(invoke(SeelenCommand.GetRadios) as Promise<RadioDevice[]>, []),
    safe(invoke(SeelenCommand.GetBluetoothDevices) as Promise<BluetoothDevice[]>, []),
  ]);
  if (version !== renderVersion) return;
  const radio = radios.find((r) => r.kind === "Bluetooth");
  const flag = radio as unknown as { is_enabled?: boolean; isEnabled?: boolean } | undefined;
  // the radio flag is the source of truth; a connected device means it is plainly on
  const on = flag?.isEnabled ?? flag?.is_enabled ?? devices.some((d) => d.connected);
  const mine = devices.filter((d) => d.paired).sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));

  const box = el("div", "slu-std-popover mx-box");
  const head = el("div", "mx-head");
  head.append(el("span", "mx-title", t("藍牙")));
  if (radio) {
    const control = toggleSwitch(on, t("藍牙"), async (v) => {
      if (radioBusy) return;
      radioBusy = true; radioError = "";
      control.disabled = true; control.setAttribute("aria-busy", "true");
      control.title = t("正在切換…");
      head.append(el("span", "mx-head-sub", t("正在切換…")));
      try { await invoke(SeelenCommand.SetRadioState, { kind: "Bluetooth" as never, enabled: v }); }
      catch (error) { radioError = String(error); }
      finally { radioBusy = false; render(); }
    });
    control.disabled = radioBusy; control.setAttribute("aria-busy", String(radioBusy));
    head.append(control);
    if (radioBusy) head.append(el("span", "mx-head-sub", t("正在切換…")));
  } else head.append(el("span", "mx-head-sub", t("找不到藍牙硬體")));
  box.append(head);
  if (radioError) { const error = el("div", "bt-pair-text", radioError); error.setAttribute("role", "status"); box.append(error); }

  if (on && radio) {
    box.append(el("div", "mx-sep"), el("div", "mx-section", t("裝置")));
    for (const d of mine) {
      const canToggle = d.connected ? d.canDisconnect : d.canConnect;
      const row = deviceRow(d, async () => {
        if (busy.has(d.id)) return;
        busy.add(d.id); pairError = "";
        render();
        try {
          await (d.connected
            ? invoke(SeelenCommand.DisconnectBluetoothDevice, { id: d.id })
            : invoke(SeelenCommand.ConnectBluetoothDevice, { id: d.id }));
        } catch (e) { pairError = String(e); }
        finally { busy.delete(d.id); render(); }
      }, d.connected ? t("按一下中斷連線") : t("按一下連線"), !busy.has(d.id) && canToggle,
        busy.has(d.id) ? (d.connected ? t("正在中斷連線…") : t("正在連線…")) : d.connected ? t("已連線") : undefined);
      const forget = el("button", "bt-forget", t("移除"));
      forget.title = t("移除這個裝置的配對");
      forget.disabled = busy.has(d.id);
      forget.addEventListener("click", async () => {
        if (busy.has(d.id)) return;
        busy.add(d.id); pairError = ""; render();
        try { await invoke(SeelenCommand.ForgetBluetoothDevice, { id: d.id }); }
        catch (e) { pairError = String(e); }
        finally { busy.delete(d.id); render(); }
      });
      row.append(forget);
      box.append(row);
    }
    if (!mine.length) box.append(el("div", "mx-empty", t("還沒有配對過的裝置")));

    // nearby devices: a disclosure, as in the macOS Bluetooth menu; opening it starts a short search
    const nearbyHead = el("button", "mx-section");
    nearbyHead.setAttribute("aria-expanded", String(showNearby));
    nearbyHead.append(el("span", "", t("附近的裝置")));
    if (scanning) nearbyHead.append(el("span", "mx-spin"));
    nearbyHead.append(svg(GLYPH.chev, 11));
    nearbyHead.addEventListener("click", () => { showNearby = !showNearby; setScanning(showNearby); render(); });
    box.append(el("div", "mx-sep"), nearbyHead);
    if (showNearby) {
      const nearby = devices.filter((d) => !d.paired && d.canPair && d.name).sort((a, b) => a.name.localeCompare(b.name));
      for (const d of nearby) {
        box.append(deviceRow(d, () => pair(d), t("按一下配對"), !busy.has(d.id) && !pairing, busy.has(d.id) ? t("正在配對…") : undefined));
        if (pairing?.id === d.id) box.append(pairPrompt(d.id, pairing.action));
      }
      if (!nearby.length) box.append(el("div", "mx-empty", scanning ? t("正在搜尋…讓裝置進入配對模式") : t("沒有找到可配對的裝置")));
      if (!scanning) { const again = settingsLink(t("重新搜尋"), () => { setScanning(true); render(); }); box.append(again); }
    }
    if (pairError) box.append(el("p", "mx-note", pairError));
  }

  box.append(el("div", "mx-sep"));
  box.append(settingsLink(t("藍牙設定…"), go("ms-settings:bluetooth")));
  root.replaceChildren(box);
}

await widget.init({ autoSizeByContent: root });
await widget.window.setTitle("@hsuan/fogline-bt").catch(console.error);
await render();
await widget.ready();
closeOnEscape(() => widget.hide());
for (const event of [SeelenEvent.BluetoothDevicesChanged, SeelenEvent.RadiosChanged]) {
  // device updates arrive often while searching; keep a half-typed PIN intact
  subscribe(event, () => { if (!document.hidden && !(pairing && document.activeElement instanceof HTMLInputElement)) render(); }).catch(console.error);
}
widget.onTrigger(() => { showNearby = false; pairing = null; pairError = ""; setScanning(false); render(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) setScanning(false); });

refreshWhenVisible(render);
