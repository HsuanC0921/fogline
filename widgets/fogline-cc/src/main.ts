import { invoke, SeelenCommand, SeelenEvent, subscribe, Widget } from "@seelen-ui/lib";
import { core } from "@seelen-ui/lib/tauri";
import type { MediaDevice, MediaPlayer, RadioDevice } from "@seelen-ui/lib/types";
import { getDisplayState, setDisplayMode, setWarmStrength, setDnd, syncDnd, type DisplayState } from "./display.ts";
import { el, GLYPH, closeOnEscape, refreshWhenVisible, safe, svg, openTarget } from "../../shared/ui.ts";
import "./style.css";
import { t } from "../../shared/i18n.ts";

const widget = Widget.self;
const root = document.getElementById("root")!;
const open = openTarget;
const go = (fn: () => unknown) => () => { widget.hide(); fn(); };
// commands newer than the bundled client library are called by their wire names
const call = <T,>(cmd: string, args?: object) => invoke(cmd as never, args as never) as Promise<T>;

const radioOn = (r?: RadioDevice) => !!r && ((r as unknown as { isEnabled?: boolean }).isEnabled ?? r.is_enabled);


let showOutputs = false;
let showWarmth = false;
let dragging = false;
let renderVersion = 0;
let refreshTimer: number | undefined;
function queueRender() {
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => { if (!document.hidden) render(); }, 80);
}
let displayState: DisplayState | null = null;
let displayBusy = false;
let displayError = "";
async function refreshDisplay() {
  try { displayState = await getDisplayState(); displayError = ""; }
  catch (error) { displayState = null; displayError = String(error); }
  render();
}
async function changeDisplay(kind: "warm" | "theme", enabled: boolean) {
  if (displayBusy || dragging) return;
  displayBusy = true;
  render();
  try { displayState = await setDisplayMode(kind, enabled); displayError = ""; }
  catch (error) { displayError = String(error); }
  finally { displayBusy = false; render(); }
}
// Keep one request in flight; intermediate drag positions are coalesced, and only release writes preferences.
let pendingWarmth: { value: number; save: boolean } | null = null;
let warmthRequest: Promise<void> | null = null;
let warmthTimer: number | undefined;
function flushWarmth(): Promise<void> {
  if (warmthRequest) return warmthRequest;
  warmthRequest = (async () => {
    while (pendingWarmth) {
      const next = pendingWarmth; pendingWarmth = null;
      try { displayState = await setWarmStrength(next.value, next.save); displayError = ""; }
      catch (error) { displayError = String(error); }
    }
  })().finally(() => { warmthRequest = null; });
  return warmthRequest;
}
function warmthControl(): HTMLElement {
  const box = el("div", "fc-warmth");
  const head = el("label", "fc-warmth-head"); head.htmlFor = "fogline-warmth";
  const value = displayState?.warmStrength ?? 50;
  const output = el("output", "", `${value}%`); output.setAttribute("for", "fogline-warmth");
  head.append(el("span", "", t("護眼強度")), output);
  const input = el("input", "fc-warmth-range");
  input.id = "fogline-warmth"; input.type = "range"; input.min = "0"; input.max = "100"; input.step = "1"; input.value = String(value);
  input.disabled = !displayState || displayBusy;
  input.setAttribute("aria-valuetext", `${value}%`);
  const update = () => {
    const value = Number(input.value); output.value = `${value}%`;
    input.setAttribute("aria-valuetext", `${value}%`);
    pendingWarmth = { value, save: false };
  };
  input.addEventListener("input", () => {
    dragging = true; update();
    if (warmthTimer === undefined) warmthTimer = window.setTimeout(() => { warmthTimer = undefined; flushWarmth(); }, 90);
  });
  const commit = async () => {
    clearTimeout(warmthTimer); warmthTimer = undefined; pendingWarmth = { value: Number(input.value), save: true };
    await flushWarmth(); dragging = false; render();
  };
  input.addEventListener("change", commit);
  input.addEventListener("pointercancel", commit);
  const ends = el("div", "fc-warmth-ends"); ends.append(el("span", "", t("較冷")), el("span", "", t("較暖")));
  box.append(head, input, ends); return box;
}
// brightness over DDC can take seconds, so it is read in the background and kept
type Monitor = { id: string; name: string; brightness?: number | null };
let monitors: Monitor[] = [];
let brightnessLoading = false;
function loadBrightness() {
  if (brightnessLoading) return;
  brightnessLoading = true;
  call<Monitor[]>("get_connected_monitors")
    .then((m) => { monitors = m; render(); })
    .catch(() => {})
    .finally(() => { brightnessLoading = false; });
}

// macOS-style slider: a thick rounded track that fills from the left, with the glyph sitting inside the fill
function slider(value: number, left: string, label: string, onInput: (v: number) => void, onGlyph?: () => void, dim = false): HTMLElement {
  const row = el("div", "fc-slider" + (dim ? " dim" : ""));
  const lg = el(onGlyph ? "button" : "span", "fc-slider-glyph");
  lg.append(svg(left, 15));
  if (onGlyph) { lg.addEventListener("click", onGlyph); lg.setAttribute("aria-label", dim ? t("取消靜音") : t("靜音")); }
  const input = el("input", "fc-range");
  input.type = "range";
  input.setAttribute("aria-label", label);
  input.min = "0";
  input.max = "100";
  input.value = String(Math.round(value));
  const paint = () => { input.style.setProperty("--v", String(Number(input.value) / 100)); row.classList.toggle("low", Number(input.value) < 8); };
  paint();
  let last = 0;
  input.addEventListener("input", () => {
    dragging = true;
    paint();
    const now = Date.now();
    if (now - last > 60) { last = now; onInput(Number(input.value)); }
  });
  input.addEventListener("change", () => { onInput(Number(input.value)); setTimeout(() => { dragging = false; render(); }, 300); });
  input.addEventListener("pointercancel", () => { dragging = false; render(); });
  row.append(lg, input);
  return row;
}

// a round glyph that fills with the accent when on, followed by a title and state, as in macOS Control Center
function toggleRow(glyph: string, title: string, sub: string, on: boolean, onClick: (e: MouseEvent) => void, cls = "fc-toggle"): HTMLButtonElement {
  const t = el("button", cls + (on ? " on" : ""));
  t.setAttribute("aria-pressed", String(on));
  const ic = el("span", "fc-round");
  ic.append(svg(glyph, 17));
  const tx = el("span", "fc-toggle-text");
  tx.append(el("span", "fc-toggle-title", title), el("span", "fc-toggle-sub", sub));
  t.append(ic, tx);
  t.addEventListener("click", onClick);
  return t;
}

// a square one-shot module with its glyph centred, like Screen Mirroring in macOS
function tile(glyph: string, label: string, on: boolean, onClick: () => void): HTMLButtonElement {
  const c = el("button", "fc-module fc-tile" + (on ? " on" : ""));
  c.title = label;
  c.setAttribute("aria-label", label);
  c.setAttribute("aria-pressed", String(on));
  c.append(svg(glyph, 20), el("span", "fc-tile-label", label));
  c.addEventListener("click", onClick);
  return c;
}
let showProject = false;
const connectivityBusy = new Set<string>();
let connectivityError = "";
let windowsDnd: boolean | null = null;
let dndRefreshing = false;
async function refreshDnd() {
  if (dndRefreshing) return;
  dndRefreshing = true;
  try { windowsDnd = await syncDnd(); } catch { windowsDnd = null; }
  finally { dndRefreshing = false; queueRender(); }
}
// Windows' own projection switcher; DisplaySwitch.exe ships with every Windows release since 7
const PROJECT_MODES = [["/internal", t("僅電腦螢幕")], ["/clone", t("同步顯示")], ["/extend", t("延伸")], ["/external", t("僅第二螢幕")]] as const;

async function render() {
  if (document.hidden && root.childElementCount) return;
  if (dragging) return;
  const version = ++renderVersion;
  const [radios, mode, devices, sessions, hotspot] = await Promise.all([
    safe(invoke(SeelenCommand.GetRadios) as Promise<RadioDevice[]>, []),
    safe(invoke(SeelenCommand.GetNotificationsMode) as Promise<string>, "All"),
    safe(invoke(SeelenCommand.GetMediaDevices) as Promise<[MediaDevice[], MediaDevice[]]>, [[], []] as [MediaDevice[], MediaDevice[]]),
    safe(invoke(SeelenCommand.GetMediaSessions) as Promise<MediaPlayer[]>, []),
    safe(call<{ state?: string } | null>("get_network_hotspot"), null),
  ]);
  if (version !== renderVersion || dragging) return;
  const wifi = radios.find((r) => r.kind === "WiFi");
  const bt = radios.find((r) => r.kind === "Bluetooth");
  const outputs = [...devices[0], ...devices[1]].filter((d) => d.type === "output");
  const out = outputs.find((d) => d.isDefaultMultimedia) ?? outputs[0];
  const player = sessions.find((s) => s.default) ?? sessions[0];
  const focus = windowsDnd ?? mode !== "All";
  const hotspotOn = String(hotspot?.state ?? "").toLowerCase() === "on";
  const dark = displayState?.dark ?? matchMedia("(prefers-color-scheme: dark)").matches;
  const night = displayState?.warm ?? false;

  const box = el("div", "slu-std-popover fc-box");

  // connectivity module on the left, now playing on the right
  const top = el("div", "fc-top");
  const left = el("div", "fc-module fc-conn");
  // as in macOS: the round glyph switches the radio, the name opens its menu (our own panel, not Settings)
  const radioRow = (r: RadioDevice | undefined, glyph: string, name: string, kind: string, panel: string) => {
    if (!r) return null;
    const on = radioOn(r);
    const row = toggleRow(glyph, name, on ? t("開啟") : t("關閉"), on, async (e) => {
      if (connectivityBusy.has(kind)) return;
      if (!(e.target as Element).closest(".fc-round")) {
        widget.hide();
        invoke(SeelenCommand.TriggerWidget, { payload: { id: panel as never } }).catch(console.error);
        return;
      }
      connectivityBusy.add(kind); connectivityError = "";
      row.disabled = true; row.setAttribute("aria-busy", "true");
      row.querySelector(".fc-toggle-sub")!.textContent = t("正在切換…");
      try { await invoke(SeelenCommand.SetRadioState, { kind: kind as never, enabled: !on }); }
      catch (error) { connectivityError = String(error); }
      finally { connectivityBusy.delete(kind); render(); }
    });
    row.disabled = connectivityBusy.has(kind);
    row.setAttribute("aria-busy", String(row.disabled));
    if (row.disabled) row.querySelector(".fc-toggle-sub")!.textContent = t("正在切換…");
    row.querySelector(".fc-round")!.setAttribute("title", on ? t("關閉{name}", { name }) : t("開啟{name}", { name }));
    row.append(svg(GLYPH.chev, 11));
    return row;
  };
  for (const p of [radioRow(wifi, GLYPH.wifi, "Wi-Fi", "WiFi", "@hsuan/fogline-net"), radioRow(bt, GLYPH.bt, t("藍牙"), "Bluetooth", "@hsuan/fogline-bt")]) if (p) left.append(p);
  const hotspotBusy = connectivityBusy.has("hotspot") || String(hotspot?.state).toLowerCase() === "intransition";
  const hotspotRow = toggleRow(GLYPH.hotspot, t("熱點"), hotspotBusy ? t("正在切換…") : hotspot ? (hotspotOn ? t("開啟") : t("關閉")) : t("設定熱點…"), hotspotOn, async () => {
    if (hotspotBusy) return;
    if (!hotspot) { widget.hide(); open("ms-settings:network-mobilehotspot"); return; }
    connectivityBusy.add("hotspot"); connectivityError = "";
    hotspotRow.disabled = true; hotspotRow.setAttribute("aria-busy", "true");
    hotspotRow.querySelector(".fc-toggle-sub")!.textContent = t("正在切換…");
    try { await call("set_network_hotspot_state", { enabled: !hotspotOn }); }
    catch (error) { connectivityError = String(error); }
    finally { connectivityBusy.delete("hotspot"); render(); }
  });
  hotspotRow.disabled = hotspotBusy; hotspotRow.setAttribute("aria-busy", String(hotspotBusy));
  left.append(hotspotRow);
  top.append(left);

  const np = el("div", "fc-module fc-np" + (player ? "" : " idle"));
  if (player?.thumbnail) {
    const bg = el("img", "fc-np-bg");
    bg.src = core.convertFileSrc(player.thumbnail);
    const art = el("img", "fc-np-art");
    art.src = bg.src;
    np.append(bg, el("div", "fc-np-shade"), art);
  }
  const meta = el("div", "fc-np-meta");
  meta.append(el("div", "fc-np-title", player ? player.title || t("未知的曲目") : t("未在播放")), el("div", "fc-np-author", player?.author ?? ""));
  const ctl = el("div", "fc-np-ctl");
  for (const [g, cmd, big] of [[GLYPH.prev, "media_prev", false], [player?.playing ? GLYPH.pause : GLYPH.play, "media_toggle_play_pause", true], [GLYPH.next, "media_next", false]] as const) {
    const b = el("button", "fc-ctl" + (big ? " big" : ""));
    const ic = svg(g, big ? 24 : 20, 0);
    ic.setAttribute("fill", "currentColor");
    b.append(ic);
    b.addEventListener("click", async () => { if (!player) return; await invoke(cmd as never, { id: player.umid } as never).catch(console.error); setTimeout(render, 300); });
    ctl.append(b);
  }
  np.append(meta, ctl);
  top.append(np);
  box.append(top);

  // focus as a wide module, then the two one-shot actions as square tiles
  const row2 = el("div", "fc-row2");
  const focusButton = toggleRow(GLYPH.focus, t("專注"), windowsDnd === null ? t("無法讀取 Windows 勿擾狀態") : focus ? t("僅限優先通知") : t("關閉"), focus, async () => {
    if (windowsDnd === null || connectivityBusy.has("dnd")) return;
    connectivityBusy.add("dnd"); connectivityError = ""; render();
    try { windowsDnd = await setDnd(!windowsDnd); }
    catch (e) { connectivityError = String(e); }
    finally { connectivityBusy.delete("dnd"); render(); }
  }, "fc-module fc-toggle fc-focus");
  focusButton.disabled = windowsDnd === null || connectivityBusy.has("dnd");
  focusButton.setAttribute("aria-busy", String(connectivityBusy.has("dnd")));
  row2.append(
    focusButton,
    tile(GLYPH.shot, t("截圖"), false, go(() => open("ms-screenclip:"))),
    tile(GLYPH.cast, t("投影"), showProject, () => { showProject = !showProject; render(); }),
  );
  box.append(row2);
  if (connectivityError) {
    const error = el("div", "fc-conn-error", connectivityError); error.setAttribute("role", "status"); box.append(error);
  }
  if (showProject) {
    const project = el("div", "fc-module fc-card");
    project.append(el("div", "fc-label", t("投影模式")));
    const list = el("div", "fc-outputs");
    for (const [flag, name] of PROJECT_MODES) {
      const r = el("button", "fc-output");
      r.append(svg(GLYPH.cast, 15), el("span", "", name));
      r.addEventListener("click", () => {
        showProject = false;
        invoke(SeelenCommand.Run, { program: "DisplaySwitch.exe", args: [flag], workingDir: null, elevated: false }).catch(console.error);
        render();
      });
      list.append(r);
    }
    project.append(list);
    box.append(project);
  }

  // display module: brightness per monitor, then appearance and eye care, like the expanded macOS Display module
  const display = el("div", "fc-module fc-card");
  display.append(el("div", "fc-label", t("顯示器")));
  for (const m of monitors.filter((x) => x.brightness != null)) {
    if (monitors.length > 1) display.append(el("div", "fc-sublabel", m.name || t("顯示器")));
    display.append(slider(m.brightness!, GLYPH.sun, t("{name}亮度", { name: m.name || t("顯示器") }), (v) => {
      m.brightness = v;
      call("set_monitor_brightness", { id: m.id, brightness: v }).catch(console.error);
    }));
  }
  const modes = el("div", "fc-modes");
  modes.append(
    toggleRow(GLYPH.appearance, t("深色模式"), dark ? t("開啟") : t("關閉"), dark, () => changeDisplay("theme", !dark), "fc-toggle fc-chip"),
    toggleRow(GLYPH.eye, t("護眼"), night ? t("暖色開啟") : t("關閉"), night, () => changeDisplay("warm", !night), "fc-toggle fc-chip"),
  );
  for (const button of Array.from(modes.querySelectorAll<HTMLButtonElement>("button"))) {
    button.disabled = displayBusy || !displayState;
    button.setAttribute("aria-busy", String(displayBusy));
  }
  display.append(modes);
  const warmthDetails = el("button", "fc-label fc-out fc-warmth-disclosure");
  warmthDetails.setAttribute("aria-expanded", String(showWarmth));
  warmthDetails.setAttribute("aria-controls", "fogline-warmth-details");
  warmthDetails.append(el("span", "", t("護眼強度")), svg(GLYPH.chev, 12));
  warmthDetails.querySelector("svg")!.style.transform = showWarmth ? "rotate(-90deg)" : "rotate(90deg)";
  warmthDetails.addEventListener("click", () => { showWarmth = !showWarmth; render(); });
  display.append(warmthDetails);
  if (showWarmth) {
    const control = warmthControl(); control.id = "fogline-warmth-details";
    display.append(control);
  }
  if (displayError) {
    const error = el("div", "fc-sublabel", displayError);
    error.setAttribute("role", "status");
    display.append(error);
  }
  box.append(display);

  if (out) {
    const card = el("div", "fc-module fc-card");
    const head = el("button", "fc-label fc-out");
    head.append(el("span", "", t("聲音")), el("span", "fc-out-name", out.name), svg(GLYPH.chev, 12));
    head.querySelector("svg")!.style.transform = showOutputs ? "rotate(-90deg)" : "rotate(90deg)";
    head.addEventListener("click", () => { showOutputs = !showOutputs; render(); });
    card.append(head);
    const frac = out.volume <= 1;
    const pct = frac ? out.volume * 100 : out.volume;
    card.append(slider(out.muted ? 0 : pct, out.muted ? GLYPH.mute : GLYPH.vol, t("音量"), (v) => {
      invoke(SeelenCommand.SetVolumeLevel, { deviceId: out.id, sessionId: null, level: frac ? v / 100 : v }).catch(console.error);
    }, async () => {
      await invoke(SeelenCommand.MediaToggleMute, { deviceId: out.id, sessionId: null }).catch(console.error);
      setTimeout(render, 200);
    }, out.muted));
    if (showOutputs && outputs.length > 1) {
      const list = el("div", "fc-outputs");
      for (const d of outputs) {
        const r = el("button", "fc-output" + (d === out ? " on" : ""));
        r.append(svg(/headphone|耳機|headset/i.test(d.name) ? GLYPH.headphones : GLYPH.speaker, 15), el("span", "", d.name));
        if (d === out) r.append(svg(GLYPH.check, 14));
        r.addEventListener("click", async () => {
          await invoke(SeelenCommand.MediaSetDefaultDevice, { id: d.id, role: "multimedia" }).catch(console.error);
          await invoke(SeelenCommand.MediaSetDefaultDevice, { id: d.id, role: "communications" }).catch(console.error);
          setTimeout(render, 300);
        });
        list.append(r);
      }
      card.append(list);
    }
    box.append(card);
  }

  root.replaceChildren(box);
}

await widget.init({ autoSizeByContent: root });
await widget.window.setTitle("@hsuan/fogline-cc").catch(console.error);
loadBrightness();
refreshDisplay();
refreshDnd();
await render();
closeOnEscape(() => { widget.hide(); });
widget.onTrigger(() => { showOutputs = false; showWarmth = false; connectivityError = ""; loadBrightness(); refreshDisplay(); refreshDnd(); render(); });
// The lazy popup is created on demand and released by widget.hide() after its idle grace period.
await widget.ready({ show: false });
// keep volume, track and radios live while the panel is open
for (const event of [SeelenEvent.MediaSessions, SeelenEvent.MediaDevices, SeelenEvent.MediaOutputs,
  SeelenEvent.RadiosChanged, SeelenEvent.SystemNetworkChanged]) {
  subscribe(event, queueRender).catch(console.error);
}
subscribe("network-hotspot-changed" as never, queueRender).catch(console.error);
subscribe(SeelenEvent.NotificationsModeChanged, refreshDnd).catch(console.error);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => refreshDisplay());

refreshWhenVisible(render);
