import { invoke, SeelenCommand, SeelenEvent, subscribe, Widget } from "@seelen-ui/lib";
import type { NetworkAdapter, RadioDevice } from "@seelen-ui/lib/types";
import { wifiAvailable, wifiConnect, wifiDisconnect, wifiForget, wifiList, wifiScan, type WifiNet } from "../../fogline-cc/src/display.ts";
import { el, GLYPH, safe, closeOnEscape, svg, toggleSwitch, settingsLink, openTarget } from "../../shared/ui.ts";
import "./style.css";
import { t } from "../../shared/i18n.ts";

const widget = Widget.self;
const root = document.getElementById("root")!;
const open = openTarget;
const go = (uri: string) => () => { widget.window.hide(); open(uri); };

let nearby: WifiNet[] = [];
let connecting: string | null = null, wifiError = "";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// join a network and wait (bounded) for Windows to report it connected; a typed password that did not work is not kept
async function connectTo(ssid: string, password: string | null, hidden: boolean, forgetOnFail: boolean): Promise<boolean> {
  connecting = ssid; wifiError = ""; render();
  try {
    await wifiConnect(ssid, password, hidden);
    for (let i = 0; i < 14; i++) {
      await sleep(800);
      nearby = await wifiList();
      if (nearby.some((n) => n.ssid === ssid && n.connected)) return true;
    }
    if (forgetOnFail) await wifiForget(ssid).catch(() => {});
    return false;
  } catch (e) { wifiError = String(e).replace(/^Error: /, ""); return false; }
  finally { connecting = null; render(); }
}
let scanning = false;
let showOthers = false;
let showDetails = false;
// joining a network in place: the ssid waiting for its password ("" = a hidden network typed by hand)
let joining: string | null = null, joinBusy = false, joinError = "";

function joinForm(ssid: string): HTMLElement {
  const form = el("form", "net-join");
  const name = el("input", "net-input");
  name.placeholder = t("網路名稱"); name.setAttribute("aria-label", t("網路名稱")); name.autocomplete = "off";
  const pass = el("input", "net-input");
  pass.type = "password"; pass.placeholder = t("密碼"); pass.setAttribute("aria-label", t("密碼")); pass.autocomplete = "off";
  if (!ssid) form.append(name);
  form.append(pass);
  if (joinError) form.append(el("p", "net-error", joinError));
  const actions = el("div", "net-actions");
  const cancel = el("button", "net-btn", t("取消")); cancel.type = "button";
  cancel.addEventListener("click", () => { joining = null; joinError = ""; render(); });
  const ok = el("button", "net-btn primary", joinBusy ? t("正在加入…") : t("加入")); ok.type = "submit"; ok.disabled = joinBusy;
  actions.append(cancel, ok); form.append(actions);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const target = ssid || name.value.trim();
    if (!target || joinBusy) return;
    joinBusy = true; joinError = ""; render();
    const ok = await connectTo(target, pass.value || null, !ssid, true);
    joinBusy = false;
    if (ok) joining = null; else joinError = wifiError || t("無法加入，請確認密碼");
    render();
  });
  queueMicrotask(() => (ssid ? pass : name).focus());
  return form;
}

// Wi-Fi fan whose arcs light up to the signal strength, as in the macOS menu
function wifiGlyph(signal: number, size = 15): SVGSVGElement {
  const level = signal >= 70 ? 3 : signal >= 45 ? 2 : signal >= 20 ? 1 : 0;
  const s = svg("", size, 2.2);
  s.replaceChildren();
  ["M12 19.5h.01", "M8.5 16a5 5 0 0 1 7 0", "M5 12.5a10 10 0 0 1 14 0", "M2 9a15 15 0 0 1 20 0"].forEach((d, i) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    if (i > level) p.setAttribute("opacity", "0.3");
    s.append(p);
  });
  return s;
}

function details(adapter: NetworkAdapter): HTMLElement {
  const dl = el("dl", "mx-details");
  for (const [k, v] of [[t("介面卡"), adapter.description || adapter.name], ["IPv4", adapter.ipv4], [t("路由器"), adapter.gateway], ["IPv6", adapter.ipv6], ["MAC", adapter.mac]] as const) {
    if (!v) continue;
    const dd = el("dd", "", v);
    dd.title = t("點一下複製");
    dd.addEventListener("click", () => navigator.clipboard.writeText(v).catch(() => {}));
    dl.append(el("dt", "", k), dd);
  }
  return dl;
}

const radioOn = (r: RadioDevice) => (r as unknown as { isEnabled?: boolean }).isEnabled ?? r.is_enabled;

// a query that never answers must not keep the panel from opening
let renderVersion = 0;

async function render() {
  const version = ++renderVersion;
  const [adapters, online, radios, localIp] = await Promise.all([
    safe(invoke(SeelenCommand.GetNetworkAdapters) as Promise<NetworkAdapter[]>, []),
    safe(invoke(SeelenCommand.GetNetworkInternetConnection) as Promise<boolean>, false),
    safe(invoke(SeelenCommand.GetRadios) as Promise<RadioDevice[]>, []),
    safe(invoke(SeelenCommand.GetNetworkDefaultLocalIp) as Promise<string>, ""),
  ]);
  if (version !== renderVersion) return;
  const wifiRadio = radios.find((r) => r.kind === "WiFi");
  const wifiOn = !!wifiRadio && radioOn(wifiRadio);
  const active = adapters.find((a) => a.ipv4 && a.ipv4 === localIp) ?? adapters.find((a) => a.status === "up" && a.ipv4);
  const connectedWifi = nearby.find((n) => n.connected);
  const isWifi = !!connectedWifi || /wi-?fi|wireless|802\.11/i.test(`${active?.name} ${active?.description} ${active?.type}`);
  const status = online ? t("已連線") : t("已連接，無法上網");

  const box = el("div", "slu-std-popover mx-box");
  const head = el("div", "mx-head");
  head.append(el("span", "mx-title", wifiRadio ? "Wi-Fi" : t("網路")));
  if (wifiRadio) {
    head.append(toggleSwitch(wifiOn, "Wi-Fi", async (v) => {
      await invoke(SeelenCommand.SetRadioState, { kind: "WiFi" as never, enabled: v });
      setTimeout(render, 600);
      if (v) scan();
    }));
  }
  box.append(head);

  // the current connection; clicking it shows the address details (Option-click in macOS)
  const current = (glyph: SVGSVGElement, name: string) => {
    const row = el("button", "mx-row on");
    const ic = el("span", "mx-ico");
    ic.append(glyph);
    const text = el("span", "mx-text");
    text.append(el("span", "mx-name", name), el("span", "mx-sub", active?.ipv4 ? `${status} · ${active.ipv4}` : status));
    const trail = el("span", "mx-trail");
    trail.append(svg(GLYPH.info, 14));
    row.append(ic, text, trail);
    row.setAttribute("aria-expanded", String(showDetails));
    row.title = t("顯示連線詳細資訊");
    row.addEventListener("click", () => { showDetails = !showDetails; render(); });
    box.append(row);
    if (showDetails && active) {
      box.append(details(active));
      if (connectedWifi?.ssid === name) {
        const actions = el("div", "net-actions net-detail-actions");
        const forget = el("button", "net-btn", t("忘記此網路"));
        forget.addEventListener("click", () => { showDetails = false; wifiForget(name).then(() => setTimeout(scan, 800)).catch((e) => { wifiError = String(e).replace(/^Error: /, ""); render(); }); });
        const off = el("button", "net-btn", t("中斷連線"));
        off.addEventListener("click", () => { showDetails = false; wifiDisconnect().then(() => setTimeout(scan, 800)).catch((e) => { wifiError = String(e).replace(/^Error: /, ""); render(); }); });
        actions.append(forget, off);
        box.append(actions);
      }
    }
  };

  if (active && !isWifi) {
    box.append(el("div", "mx-sep"), el("div", "mx-section", t("乙太網路")));
    current(svg(GLYPH.wired, 15), t("乙太網路"));
  }

  if (wifiOn) {
    // one row per network name: several access points of one network show as its strongest
    const named = nearby.filter((n) => n.ssid);
    const known = named.filter((n) => n.connected || n.known);
    const others = named.filter((n) => !n.connected && !n.known);
    const netRow = (n: WifiNet) => {
      if (n.connected && active) return current(wifiGlyph(n.signal), n.ssid!);
      const r = el("button", "mx-row");
      const ic = el("span", "mx-ico");
      ic.append(wifiGlyph(n.signal));
      const text = el("span", "mx-text");
      text.append(el("span", "mx-name", n.ssid!));
      if (connecting === n.ssid) text.append(el("span", "mx-sub", t("正在連線…")));
      r.append(ic, text);
      if (n.secured) { const t = el("span", "mx-trail"); t.append(svg(GLYPH.lock, 13)); r.append(t); }
      r.addEventListener("click", () => {
        // enterprise sign-in (802.1X) needs certificates and accounts the panel cannot collect; say so instead of leaving for Settings
        if (n.secured && !n.known && /enterprise|802\.1x/i.test(n.auth)) { wifiError = t("企業網路（802.1X）需要憑證，無法在這裡加入。"); return render(); }
        if (n.secured && !n.known) { joining = n.ssid!; joinError = ""; return render(); }
        if (connecting) return;
        connectTo(n.ssid!, null, false, false);
      });
      box.append(r);
      if (joining === n.ssid) box.append(joinForm(n.ssid!));
    };

    box.append(el("div", "mx-sep"), el("div", "mx-section", t("已知網路")));
    if (known.length) known.forEach(netRow);
    else box.append(el("div", "mx-empty", scanning ? t("正在搜尋…") : nearby.length ? t("附近沒有已儲存的網路") : t("沒有偵測到 Wi-Fi 網路，介面卡可能尚未就緒")));

    const more = el("button", "mx-section" + (scanning ? " mx-spin" : ""));
    more.append(el("span", "", t("其他網路")));
    const trail = el("span", "mx-trail");
    trail.append(svg(scanning ? GLYPH.restart : GLYPH.chev, 12));
    more.append(trail);
    more.setAttribute("aria-expanded", String(showOthers));
    more.addEventListener("click", () => { showOthers = !showOthers; render(); if (showOthers) scan(); });
    box.append(more);
    if (showOthers) {
      if (others.length) others.forEach(netRow);
      else box.append(el("div", "mx-empty", scanning ? t("正在搜尋…") : t("找不到其他網路")));
      box.append(settingsLink(t("加入隱藏的網路…"), () => { joining = ""; joinError = ""; render(); }));
      if (joining === "") box.append(joinForm(""));
    }
  } else if (wifiRadio && !active) {
    box.append(el("div", "mx-note", t("Wi-Fi 已關閉，也沒有有線連線。")));
  }

  if (wifiError) { const note = el("div", "mx-note", wifiError); note.setAttribute("role", "status"); box.append(note); }
  box.append(el("div", "mx-sep"));
  box.append(settingsLink(t(wifiRadio ? "Wi-Fi 設定…" : "網路設定…"), go(wifiRadio ? "ms-settings:network-wifi" : "ms-settings:network")));
  root.replaceChildren(box);
}

// scanning makes Windows ask for location access, so it only runs when Wi-Fi is on and the user can use the result
async function scan() {
  if (scanning) return;
  const radios = await safe(invoke(SeelenCommand.GetRadios) as Promise<RadioDevice[]>, []);
  if (!radios.some((r) => r.kind === "WiFi" && radioOn(r))) return;
  if (scanning) return;
  scanning = true; wifiError = "";
  render();
  if (wifiAvailable()) {
    try { await wifiScan(); await sleep(2500); nearby = await wifiList(); }
    catch (e) { wifiError = String(e).replace(/^Error: /, ""); }
    scanning = false; render();
    return;
  }
  await invoke(SeelenCommand.WlanScan).catch(() => {});
  setTimeout(() => { scanning = false; render(); }, 4000);
}

await widget.init({ autoSizeByContent: root });
await widget.window.setTitle("@hsuan/fogline-net").catch(console.error);
await render();
subscribe(SeelenEvent.NetworkWlanScanned, (e) => {
  if (wifiAvailable()) return;
  nearby = e.payload.filter((n) => n.ssid).map((n) => ({ ssid: n.ssid!, signal: n.signal, secured: n.secured, auth: n.auth, connected: n.connected, known: n.known }));
  scanning = false;
  if (joining === null) render();
}).catch(console.error);
await widget.ready();
closeOnEscape(() => widget.window.hide());
for (const event of [SeelenEvent.NetworkAdapters, SeelenEvent.NetworkInternetConnection, SeelenEvent.RadiosChanged]) {
  // keep a half-typed password intact
  subscribe(event, () => { if (!document.hidden && joining === null) render(); }).catch(console.error);
}
widget.onTrigger(() => { showOthers = false; showDetails = false; joining = null; joinError = ""; render(); scan(); });
