import { invoke, SeelenCommand, Widget } from "@seelen-ui/lib";
import { el, GLYPH, closeOnEscape, svg, openTarget } from "../../shared/ui.ts";
import { COMMON, SOURCE, availableCountries, countryName, dataStatus, type Country, type Holiday, holidays, refine } from "./holidays.ts";
import "./style.css";
import { t, lang, locale } from "../../shared/i18n.ts";

const widget = Widget.self;
const root = document.getElementById("root")!;
const open = openTarget;

// the lunar calendar is only shown in Traditional Chinese
const useLunar = lang === "zh";
const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
const WEEK = [0, 1, 2, 3, 4, 5, 6].map((i) => weekdayFmt.format(new Date(2023, 0, 1 + i))); // 2023-01-01 is a Sunday
const yearName = (y: number) => lang === "zh" ? `${y} 年` : lang === "ja" ? `${y}年` : String(y);
const monthName = (m: number, style: "long" | "short") => lang === "zh" ? `${m + 1} 月` : new Intl.DateTimeFormat(locale, { month: style }).format(new Date(2000, m, 1));
const LUNAR_DAY = [
  "", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
];
const lunarFmt = new Intl.DateTimeFormat("zh-TW-u-ca-chinese", { month: "long", day: "numeric" });

// the day of the lunar month, and the month name when a new lunar month starts
function lunar(d: Date): { day: string; first: boolean; month: string } {
  const parts = lunarFmt.formatToParts(d);
  const n = Number(parts.find((p) => p.type === "day")?.value);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return { day: LUNAR_DAY[n] ?? "", first: n === 1, month };
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// ISO week number
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
}
const dayOfYear = (d: Date) => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 86400000);

let view = new Date();
view.setDate(1);
let selected = new Date();
let picking = false;
let expanded = false;
let country: Country = (() => { try { const c = localStorage.getItem("fogline-cal-country"); return c && /^[A-Z]{2}$/.test(c) ? c : "TW"; } catch { return "TW"; } })();
// the country list is only fetched when the picker is first opened
let pickingCountry = false, countries: Country[] | null = null, countriesFailed = false;
function openCountries() {
  pickingCountry = !pickingCountry;
  if (pickingCountry && !countries && !countriesFailed) availableCountries().then((c) => { countries = c; render(); }).catch(() => { countriesFailed = true; render(); });
  render();
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const holidayOf = (d: Date): Holiday | undefined => holidays(country, d.getFullYear()).get(ymd(d));
// Fetch public data into the persistent cache; redraw when it arrives.
const refined = new Map<string, number>();
function load(years: number[]) {
  for (const y of years) {
    const id = `${country}${y}`;
    if ((refined.get(id) ?? 0) > Date.now()) continue;
    refined.set(id, Infinity);
    refine(country, y).then((ok) => {
      refined.set(id, Date.now() + (ok ? 7 * 86400000 : 5 * 60000));
      render();
    }).catch(() => { refined.set(id, Date.now() + 5 * 60000); });
  }
}

// the next few days off after today, looking into next year
function upcoming(from: Date, n: number): Array<[Date, Holiday]> {
  const out: Array<[Date, Holiday]> = [];
  for (let i = 1; i <= 400 && out.length < n; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const h = holidayOf(d);
    if (h?.off && h.kind !== "weekend" && !(h.name === out[out.length - 1]?.[1].name && i - Math.round((out[out.length - 1][0].getTime() - from.getTime()) / 86400000) === 1)) out.push([d, h]);
  }
  return out;
}

function render() {
  const today = new Date();
  // only years that are on screen (a grid shows spill-over days from the neighbouring months) or upcoming soon
  const years = new Set([view.getFullYear(), today.getFullYear()]);
  if (view.getMonth() === 0) years.add(view.getFullYear() - 1);
  if (view.getMonth() === 11) years.add(view.getFullYear() + 1);
  if (today.getMonth() >= 9) years.add(today.getFullYear() + 1);
  load([...years]);
  const box = el("div", "slu-std-popover fcal-box");
  const details = el("details", "fcal-details"); details.open = expanded;
  const detailsTitle = el("summary", "", t("假日"));
  details.append(detailsTitle);
  details.addEventListener("toggle", () => { expanded = details.open; });
  // header: month (or year while picking) with a disclosure, then back / today / forward
  const head = el("div", "fcal-head");
  const title = el("button", "fcal-title" + (picking ? " open" : ""));
  title.setAttribute("aria-expanded", String(picking));
  title.title = picking ? t("回到月曆") : t("選擇年份與月份");
  title.append(el("span", "fcal-title-m", picking ? yearName(view.getFullYear()) : monthName(view.getMonth(), "long")));
  if (!picking) title.append(el("span", "fcal-title-y", String(view.getFullYear())));
  title.append(svg(GLYPH.chev, 12));
  title.addEventListener("click", () => { picking = !picking; render(); });
  const nav = el("div", "fcal-nav");
  const step = (n: number) => () => {
    if (picking) view.setFullYear(view.getFullYear() + n);
    else view.setMonth(view.getMonth() + n);
    render();
  };
  const prev = el("button", "fcal-btn"); prev.append(svg(GLYPH.left, 14)); prev.addEventListener("click", step(-1));
  const next = el("button", "fcal-btn"); next.append(svg(GLYPH.right, 14)); next.addEventListener("click", step(1));
  prev.setAttribute("aria-label", picking ? t("上一年") : t("上一個月"));
  next.setAttribute("aria-label", picking ? t("下一年") : t("下一個月"));
  const now = el("button", "fcal-today", t("今天"));
  now.addEventListener("click", () => { view = new Date(); view.setDate(1); selected = new Date(); picking = false; render(); });
  nav.append(prev, now, next);
  head.append(title, nav);
  box.append(head);

  if (picking) {
    const yearRow = el("label", "fcal-jump");
    yearRow.append(el("span", "", t("跳至日期")));
    const date = el("input", "fcal-date-input");
    date.type = "date";
    date.value = ymd(selected);
    date.addEventListener("change", () => {
      const target = new Date(`${date.value}T12:00:00`);
      if (!Number.isFinite(target.getTime())) return;
      selected = target; view = new Date(target.getFullYear(), target.getMonth(), 1); picking = false; render();
    });
    yearRow.append(date); box.append(yearRow);
    const months = el("div", "fcal-months");
    for (let m = 0; m < 12; m++) {
      const b = el("button", "fcal-month" + (m === today.getMonth() && view.getFullYear() === today.getFullYear() ? " today" : "") + (m === view.getMonth() ? " on" : ""), monthName(m, "short"));
      b.addEventListener("click", () => { view.setMonth(m); picking = false; render(); });
      months.append(b);
    }
    box.append(months);
  } else {
    // grid: 7 days, Sunday first; week numbers live in the day details
    const grid = el("div", "fcal-grid");
    WEEK.forEach((w, i) => grid.append(el("span", "fcal-wd" + (i === 0 || i === 6 ? " we" : ""), w)));
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()) / 7);
    for (let w = 0; w < weeks; w++) {
      const rowStart = new Date(start);
      rowStart.setDate(start.getDate() + w * 7);
      for (let i = 0; i < 7; i++) {
        const d = new Date(rowStart);
        d.setDate(rowStart.getDate() + i);
        const l = lunar(d);
        const h = holidayOf(d);
        const cell = el("button", "fcal-cell" + (h?.off && h.kind !== "weekend" ? " hol" : h?.kind === "workday" ? " work" : "") + (d.getMonth() !== view.getMonth() ? " off" : "") + (i === 0 || i === 6 ? " we" : "") + (sameDay(d, today) ? " today" : "") + (sameDay(d, selected) ? " sel" : ""));
        const tag = h && h.kind !== "weekend" ? (h.off ? h.name : t("補班")) : !useLunar ? "" : l.first ? l.month : l.day;
        cell.setAttribute("aria-label", `${ymd(d)}${useLunar ? `，農曆${l.month}${l.day}` : ""}${h ? `，${h.name}` : ""}`);
        cell.setAttribute("aria-pressed", String(sameDay(d, selected)));
        if (sameDay(d, today)) cell.setAttribute("aria-current", "date");
        cell.append(el("span", "fcal-n", String(d.getDate())), el("span", "fcal-l" + (l.first && !h ? " m" : "") + (h ? " h" : ""), /[\u3000-\u9fff]/.test(tag) && tag.length > 4 ? tag.slice(0, 4) : tag));
        if (h) cell.title = h.name;
        cell.addEventListener("click", () => { selected = d; if (d.getMonth() !== view.getMonth()) { view = new Date(d.getFullYear(), d.getMonth(), 1); } render(); });
        grid.append(cell);
      }
    }
    box.append(grid);

    // details of the selected day
    const l = lunar(selected);
    const info = el("div", "fcal-info");
    info.append(
      el("div", "fcal-info-main", new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long" }).format(selected)),
      el("div", "fcal-info-sub", `${useLunar ? `農曆${l.month}${l.day}　·　` : ""}${t("第 {w} 週　·　今年第 {d} 天", { w: isoWeek(selected), d: dayOfYear(selected) })}`),
    );
    const sh = holidayOf(selected);
    if (sh) info.append(el("div", "fcal-info-hol" + (sh.off ? "" : " work"), sh.off ? sh.name : t("{name}（上班日）", { name: sh.name })));
    if (!sameDay(selected, today)) {
      const diff = Math.round((Date.UTC(selected.getFullYear(), selected.getMonth(), selected.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
      info.append(el("div", "fcal-info-sub", diff > 0 ? t("{n} 天後", { n: diff }) : t("{n} 天前", { n: -diff })));
    }
    box.append(info);
  }

  if (!picking) {
    const next = upcoming(today, 3);
    if (next.length) {
      const list = el("div", "fcal-next");
      list.append(el("div", "fcal-next-head", t("近期假日")));
      for (const [d, h] of next) {
        const diff = Math.round((d.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
        const r = el("button", "fcal-next-row");
        r.append(el("span", "fcal-next-date", `${d.getMonth() + 1}/${d.getDate()}`), el("span", "fcal-next-name", h.name), el("span", "fcal-next-in", t("{n} 天後", { n: diff })));
        r.addEventListener("click", () => { selected = d; view = new Date(d.getFullYear(), d.getMonth(), 1); render(); });
        list.append(r);
      }
      details.append(list);
    }
  }
  // region: one row that opens a scrolling list, common countries first, then everything the data source covers
  const region = el("button", "fcal-region");
  region.setAttribute("aria-expanded", String(pickingCountry));
  region.append(el("span", "fcal-chips-label", "地區"), el("span", "fcal-region-name", countryName(country)), svg(GLYPH.chev, 11));
  region.addEventListener("click", openCountries);
  details.append(region);
  if (pickingCountry) {
    const list = el("div", "fcal-countries");
    const known = countries ? new Set(countries) : null;
    const common = COMMON.filter((c) => !known || known.has(c));
    const rest = (countries ?? []).filter((c) => !common.includes(c)).sort((a, b) => countryName(a).localeCompare(countryName(b), "zh-TW"));
    for (const c of [...new Set([country, ...common, ...rest])]) {
      const b = el("button", "fcal-country" + (c === country ? " on" : ""));
      b.append(el("span", "", countryName(c)), c === country ? svg(GLYPH.check, 13, 2.4) : el("span", "fcal-code", c));
      b.addEventListener("click", () => { country = c; pickingCountry = false; try { localStorage.setItem("fogline-cal-country", c); } catch { /* optional */ } render(); });
      list.append(b);
    }
    if (!countries && !countriesFailed) list.append(el("div", "mx-empty", "載入國家清單…"));
    if (countriesFailed) list.append(el("div", "mx-empty", "無法取得完整清單，僅顯示常見國家"));
    details.append(list);
  }
  const status = dataStatus(country, view.getFullYear());
  const statusText = { loading: t("更新中…"), fresh: t("資料已快取"), cached: t("使用快取"), offline: t("離線・使用上次快取"), unavailable: t("此年度假日資料暫不可用") }[status.state];
  const source = el("div", "fcal-source");
  const sourceText = el("span", "", `${SOURCE(country)} · ${statusText}`);
  if (status.updated) sourceText.title = t("上次更新：{time}", { time: new Date(status.updated).toLocaleString(locale) });
  const refresh = el("button", "fcal-btn");
  refresh.title = t("立即更新假日資料"); refresh.setAttribute("aria-label", refresh.title);
  refresh.disabled = status.state === "loading";
  refresh.append(svg(GLYPH.restart, 14));
  refresh.addEventListener("click", () => {
    const c = country, year = view.getFullYear();
    refined.set(`${c}${year}`, Infinity);
    const update = refine(c, year, true);
    render();
    update.finally(() => { refined.set(`${c}${year}`, Date.now() + 5 * 60000); render(); });
  });
  source.append(sourceText, refresh); details.append(source);
  details.append(el("div", "fcal-sep"));
  const link = el("button", "fcal-link");
  link.append(el("span", "", t("日期與時間設定…")));
  link.addEventListener("click", () => { widget.hide(); open("ms-settings:dateandtime"); });
  details.append(link);
  box.append(details);
  root.replaceChildren(box);
}

await widget.init({ autoSizeByContent: root });
await widget.window.setTitle("@hsuan/fogline-cal").catch(console.error);
render();
closeOnEscape(() => widget.hide());
widget.onTrigger(() => { view = new Date(); view.setDate(1); selected = new Date(); picking = false; pickingCountry = false; render(); });
// Read persistent calendar caches on demand; no calendar WebView is needed at login.
await widget.ready({ show: false });
