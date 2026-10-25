import { invoke, SeelenCommand } from "@seelen-ui/lib";
import { NotificationsMode } from "@seelen-ui/lib/types";
import { t } from "../../shared/i18n.ts";

declare global {
  interface Window { foglineDisplay?: { program: string; port: number; token: string } }
}
export type DisplayState = { warm: boolean; dark: boolean; warmStrength: number };
let starting: Promise<void> | null = null;
let displayRead: Promise<DisplayState> | null = null;
async function request<T = DisplayState>(path: string, method: string): Promise<T> {
  const config = window.foglineDisplay;
  if (!config) throw new Error(t("請重新執行 Fogline 安裝程式，以啟用顯示控制。"));
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method, headers: { Authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || t("顯示控制無法使用。"));
  return result;
}
export function getDisplayState(): Promise<DisplayState> {
  if (!displayRead) displayRead = readDisplayState().finally(() => { displayRead = null; });
  return displayRead;
}
async function readDisplayState(): Promise<DisplayState> {
  try { return await request("/state", "GET"); }
  catch (error) {
    if (!window.foglineDisplay) throw error;
    if (!starting) starting = (async () => {
      const config = window.foglineDisplay!;
      await invoke(SeelenCommand.Run, {
        program: config.program, args: [String(config.port), config.token], workingDir: null, elevated: false,
      });
      // Bounded startup wait, only on demand. The native process sleeps while idle.
      for (let i = 0; i < 6; i++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        try { await request("/state", "GET"); return; } catch { /* still starting */ }
      }
      throw new Error(t("顯示控制未啟動；請確認 Seelen 已允許執行 FoglineDisplay。"));
    })().finally(() => { starting = null; });
    await starting;
    return request("/state", "GET");
  }
}
// Reads go straight to their endpoint. Start the bridge only if the first read fails;
// repeated reads no longer fetch /state first, and mutation requests are never retried.
async function readBridge<T>(path: string): Promise<T> {
  try { return await request<T>(path, "GET"); }
  catch {
    await getDisplayState();
    return request<T>(path, "GET");
  }
}
export async function setDisplayMode(kind: "warm" | "theme", enabled: boolean): Promise<DisplayState> {
  await getDisplayState();
  return request(`/${kind}/${kind === "warm" ? enabled ? "on" : "off" : enabled ? "dark" : "light"}`, "POST");
}
export async function setWarmStrength(value: number, save = false): Promise<DisplayState> {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new RangeError("Warmth must be between 0 and 100");
  return request(`/warm/strength?value=${value}${save ? "&save=1" : ""}`, "POST");
}
export type InputState = { available: boolean; languageCode?: string; native?: boolean; fullShape?: boolean; katakana?: boolean };
export async function getInputState(): Promise<InputState> {
  return readBridge<InputState>("/ime/state");
}
export async function setInputMode(native: boolean): Promise<InputState> {
  await getDisplayState();
  const state = await request<InputState>(`/ime/${native ? "native" : "direct"}`, "POST");
  if (!state.available) throw new Error(t("無法直接切換這個輸入法，請使用原本的輸入法快捷鍵。"));
  return state;
}
export async function setInputWidth(full: boolean): Promise<InputState> {
  await getDisplayState();
  const state = await request<InputState>(`/ime/${full ? "full" : "half"}`, "POST");
  if (!state.available) throw new Error(t("這個輸入法未提供直接切換介面，請使用原生語言列。"));
  return state;
}
export async function showLanguageBar(): Promise<void> {
  await getDisplayState();
  await request("/ime/language-bar", "POST");
}

// Wi-Fi through the helper (Native Wifi API). Seelen's own module cannot attach to some adapters.
export type WifiNet = { ssid: string; signal: number; secured: boolean; auth: string; connected: boolean; known: boolean };
export const wifiAvailable = () => !!window.foglineDisplay;
export async function wifiList(): Promise<WifiNet[]> {
  const { networks } = await readBridge<{ networks: WifiNet[] }>("/wifi/list");
  // one row per network name: an access point that offers WPA2 and WPA3 shows up twice
  const merged = new Map<string, WifiNet>();
  for (const n of networks) {
    const seen = merged.get(n.ssid);
    if (!seen) { merged.set(n.ssid, { ...n }); continue; }
    seen.signal = Math.max(seen.signal, n.signal);
    seen.connected ||= n.connected;
    if (n.known && !seen.known) { seen.known = true; seen.auth = n.auth; }
  }
  return [...merged.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || b.signal - a.signal);
}
export async function wifiScan(): Promise<void> { await getDisplayState(); await request("/wifi/scan", "POST"); }
export async function wifiConnect(ssid: string, password: string | null, hidden: boolean): Promise<void> {
  await getDisplayState();
  await request(`/wifi/connect?ssid=${encodeURIComponent(ssid)}${password ? `&password=${encodeURIComponent(password)}` : ""}${hidden ? "&hidden=1" : ""}`, "POST");
}
export async function wifiForget(ssid: string): Promise<void> { await getDisplayState(); await request(`/wifi/forget?ssid=${encodeURIComponent(ssid)}`, "POST"); }
export async function wifiDisconnect(): Promise<void> { await getDisplayState(); await request("/wifi/disconnect", "POST"); }

// Do Not Disturb belongs to Windows. Seelen keeps its own notification mode (it drives the menu bar indicator), so every change
// is made on Windows first and mirrored into Seelen, and every read goes the other way round.
async function mirrorDnd(on: boolean) {
  const current = await invoke(SeelenCommand.GetNotificationsMode);
  if ((current !== NotificationsMode.All) !== on) await invoke(SeelenCommand.SetNotificationsMode, { mode: on ? NotificationsMode.PriorityOnly : NotificationsMode.All });
}
export async function syncDnd(): Promise<boolean> {
  const { dnd } = await readBridge<{ dnd: boolean }>("/dnd");
  await mirrorDnd(dnd);
  return dnd;
}
export async function setDnd(on: boolean): Promise<boolean> {
  await getDisplayState();
  const { dnd } = await request<{ dnd: boolean }>(`/dnd/${on ? "on" : "off"}`, "POST");
  await mirrorDnd(dnd);
  return dnd;
}

export type FileHit = { name: string; path: string };
export async function searchFiles(query: string): Promise<FileHit[]> {
  return (await readBridge<{ files: FileHit[] }>(`/files?q=${encodeURIComponent(query)}`)).files;
}
