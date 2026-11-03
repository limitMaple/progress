// 日付とタイムゾーンの計算。Web アプリからも import するので、Node に依存しないこと。
//
// 日付は "YYYY-MM-DD"、時刻はその日の 0:00 からの分。どちらも呼ぶ側が渡すタイムゾーンで読む
// （Functions は UTC で動くので、実行環境のタイムゾーンには頼らない）。

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
export const WEEKDAYS = '日月火水木金土';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" の形で、実在する日付か。 */
export function isDate(value: string): boolean {
  return DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
}

/** タイムゾーンの名前として使えるか。 */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" の曜日（0 が日曜）。 */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "YYYY-MM-DD" の days 日後。 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** from から to までの日数（to が前なら負）。 */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** 「10/30（金）」の形。 */
export function dateLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WEEKDAYS[weekdayOf(date)]}）`;
}

/** 時刻 ms の、timeZone での日付 "YYYY-MM-DD"。 */
export function zonedDate(ms: number, timeZone: string): string {
  return new Date(ms + offsetOf(ms, timeZone)).toISOString().slice(0, 10);
}

/** timeZone での日付 date の minutes 分（その日の 0:00 から）を、時刻 ms にする。 */
export function zonedTime(date: string, minutes: number, timeZone: string): number {
  const wall = new Date(`${date}T00:00:00Z`).getTime() + minutes * MIN;
  // 壁時計の値から時差を引く。時差はその時刻で決まるので、求めた時刻の時差でもう一度合わせる
  const guess = wall - offsetOf(wall, timeZone);
  return wall - offsetOf(guess, timeZone);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** 時刻 ms での timeZone の時差（壁時計 − UTC, ms）。 */
function offsetOf(ms: number, timeZone: string): number {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  const part = Object.fromEntries(formatter.formatToParts(ms).map((p) => [p.type, Number(p.value)]));
  const wall = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  return wall - Math.floor(ms / 1000) * 1000;
}
