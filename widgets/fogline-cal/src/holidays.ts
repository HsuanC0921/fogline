import { t, locale } from "../../shared/i18n.ts";
// API-only public holidays. Cached data stays usable offline; missing data is never inferred.
// ISO 3166 alpha-2. Taiwan and Japan have dedicated sources; every other country comes from Nager.Date.
export type Country = string;
export type Holiday = { name: string; off: boolean; kind?: "holiday" | "weekend" | "workday" };
// shown first in the picker; the full list is fetched only when the picker is opened
export const COMMON: Country[] = ["TW", "JP", "US", "KR", "CN", "HK", "SG", "GB", "CA", "AU", "DE", "FR", "VN", "TH"];
const regionNames = (() => { try { return new Intl.DisplayNames([locale], { type: "region" }); } catch { return null; } })();
export const countryName = (code: Country) => { try { return regionNames?.of(code) ?? code; } catch { return code; } };
export const SOURCE = (country: Country) => country === "TW" ? "TaiwanCalendar" : country === "JP" ? "holidays-jp" : "Nager.Date";
const urlOf = (country: Country, year: number) => country === "TW" ? `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`
  : country === "JP" ? "https://holidays-jp.github.io/api/v1/date.json"
  : `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;

// countries Nager.Date has data for, fetched once per month and only when asked for
export async function availableCountries(): Promise<Country[]> {
  const key = "fogline-hol-countries-v1";
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (saved && Date.now() - saved.t < 30 * 86400000 && Array.isArray(saved.codes)) return saved.codes;
  } catch { /* optional storage */ }
  const list = await download("https://date.nager.at/api/v3/AvailableCountries") as Array<{ countryCode?: string }>;
  if (!Array.isArray(list)) throw new Error("Invalid Nager.Date response");
  const codes = [...new Set(["TW", "JP", ...list.map((c) => c.countryCode ?? "").filter((c) => /^[A-Z]{2}$/.test(c))])];
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), codes })); } catch { /* optional storage */ }
  return codes;
}
const TTL = 7 * 86400000;
type RecordData = { t: number; entries: Array<[string, Holiday]> };
export type DataStatus = { state: "loading" | "fresh" | "cached" | "offline" | "unavailable"; updated?: number };
const cache = new Map<string, Map<string, Holiday>>();
const statuses = new Map<string, DataStatus>();
const inflight = new Map<string, Promise<boolean>>();
const downloads = new Map<string, Promise<unknown>>();
const retryAfter = new Map<string, number>();
function stored(id: string): RecordData | null {
  try {
    const record = JSON.parse(localStorage.getItem(`fogline-hol-api-v2-${id}`) ?? "null");
    if (!record || !Number.isFinite(record.t) || !Array.isArray(record.entries)) return null;
    if (!record.entries.every((entry: unknown) => Array.isArray(entry) && /^\d{4}-\d{2}-\d{2}$/.test(entry[0]) && entry[1] && typeof entry[1].name === "string" && typeof entry[1].off === "boolean")) return null;
    return record;
  } catch { return null; }
}
function store(id: string, record: RecordData) {
  try { localStorage.setItem(`fogline-hol-api-v2-${id}`, JSON.stringify(record)); } catch { /* optional storage */ }
}
export function holidays(country: Country, year: number): Map<string, Holiday> {
  const id = `${country}${year}`;
  if (!cache.has(id)) {
    const saved = stored(id);
    cache.set(id, new Map(saved?.entries ?? []));
    statuses.set(id, saved ? { state: Date.now() - saved.t < TTL ? "fresh" : "cached", updated: saved.t } : { state: "unavailable" });
  }
  return cache.get(id)!;
}
export function dataStatus(country: Country, year: number): DataStatus {
  holidays(country, year);
  return statuses.get(`${country}${year}`)!;
}
function decode(country: Country, year: number, data: unknown): Map<string, Holiday> {
  const result = new Map<string, Holiday>();
  if (country === "TW") {
    if (!Array.isArray(data)) throw new Error("Invalid TaiwanCalendar response");
    for (const entry of data) {
      if (!entry || typeof entry.date !== "string" || !/^\d{8}$/.test(entry.date) || typeof entry.isHoliday !== "boolean") continue;
      const date = `${entry.date.slice(0, 4)}-${entry.date.slice(4, 6)}-${entry.date.slice(6, 8)}`;
      if (!date.startsWith(`${year}-`)) continue;
      const day = new Date(`${date}T00:00:00`).getDay();
      const weekend = day === 0 || day === 6;
      const description = typeof entry.description === "string" ? entry.description.trim().replace(/補行上班/g, "補班") : "";
      if (entry.isHoliday || description || weekend) result.set(date, {
        name: description || (entry.isHoliday ? t("週末") : t("補班")), off: entry.isHoliday,
        kind: !entry.isHoliday ? "workday" : description ? "holiday" : "weekend",
      });
    }
  } else if (country === "JP") {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid holidays-jp response");
    for (const [date, name] of Object.entries(data)) if (date.startsWith(`${year}-`) && /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof name === "string") result.set(date, { name, off: true, kind: "holiday" });
  } else {
    if (!Array.isArray(data)) throw new Error("Invalid Nager.Date response");
    // regional holidays (global: false) would mark days off that are not off for everyone
    for (const entry of data) if (entry && typeof entry.date === "string" && entry.date.startsWith(`${year}-`) && typeof entry.name === "string" && entry.global !== false && (!entry.types || entry.types.includes("Public"))) result.set(entry.date, { name: typeof entry.localName === "string" && entry.localName ? entry.localName : entry.name, off: true, kind: "holiday" });
  }
  if (!result.size) throw new Error("No public holiday data for this year");
  return result;
}
export async function download(url: string): Promise<unknown> {
  if (!downloads.has(url)) downloads.set(url, fetch(url, { signal: AbortSignal.timeout(5000) }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }).finally(() => { downloads.delete(url); }));
  return downloads.get(url)!;
}
export function refine(country: Country, year: number, force = false): Promise<boolean> {
  const id = `${country}${year}`;
  holidays(country, year);
  if (inflight.has(id)) return inflight.get(id)!;
  const status = statuses.get(id)!;
  if (!force && status.updated && Date.now() - status.updated < TTL) return Promise.resolve(true);
  if (!force && (retryAfter.get(id) ?? 0) > Date.now()) return Promise.resolve(false);
  statuses.set(id, { state: "loading", updated: status.updated });
  const work = (async () => {
    try {
      const entries = decode(country, year, await download(urlOf(country, year)));
      const time = Date.now();
      cache.set(id, entries); store(id, { t: time, entries: [...entries] });
      statuses.set(id, { state: "fresh", updated: time }); retryAfter.delete(id);
      return true;
    } catch {
      statuses.set(id, { state: cache.get(id)!.size ? "offline" : "unavailable", updated: status.updated });
      retryAfter.set(id, Date.now() + 5 * 60000); return false;
    } finally { inflight.delete(id); }
  })();
  inflight.set(id, work); return work;
}
