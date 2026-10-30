// スケジュール（「毎週 月水金 9:00〜18:00 に 2 時間やる」のような繰り返しの約束）の計算。
// 保存する形は model.ts の ScheduleData。Web アプリからも import するので、Node に依存しないこと。
//
// スケジュールは、各回のカウント開始の時刻になったらセッションを作る（scheduler.ts）。
// それより前なら、その回だけ休める（skipDates に日付を足す）。作ったあとのセッションは手で始めたものと同じで、変えられない。
//
// 日付は "YYYY-MM-DD"、時刻はその日の 0:00 からの分。どちらもスケジュールの timeZone で読む
// （Functions は UTC で動くので、実行環境のタイムゾーンには頼らない）。

import { formatDuration } from './progress.ts';
import type { ScheduleData } from './model.ts';

const DAY_MIN = 24 * 60;
const MIN = 60 * 1000;
const WEEKDAYS = '日月火水木金土';

/** スケジュールの 1 回分。 */
export interface Occurrence {
  /** カウント開始の日付（スケジュールの timeZone での "YYYY-MM-DD"） */
  date: string;
  startAt: number;
  due: number;
}

/** 回の計算に要る項目。 */
type Timing = Pick<ScheduleData, 'weekdays' | 'startMinutes' | 'dueMinutes' | 'timeZone'>;

/** 締切の時刻が開始の時刻以前なら、翌日の締切とする。開始から締切までの分。 */
export function windowMinutes({ startMinutes, dueMinutes }: Pick<ScheduleData, 'startMinutes' | 'dueMinutes'>): number {
  return dueMinutes > startMinutes ? dueMinutes - startMinutes : dueMinutes + DAY_MIN - startMinutes;
}

/** その日の回。曜日が合わなければ null。 */
export function occurrenceOn(schedule: Timing, date: string): Occurrence | null {
  if (!schedule.weekdays.includes(weekdayOf(date))) return null;
  const startAt = zonedTime(date, schedule.startMinutes, schedule.timeZone);
  // 夏時間の切り替わりの日でも締切がずれないよう、締切の日付と時刻から求める
  const dueDate = schedule.dueMinutes > schedule.startMinutes ? date : addDays(date, 1);
  return { date, startAt, due: zonedTime(dueDate, schedule.dueMinutes, schedule.timeZone) };
}

/** after より後にカウント開始する回を、早い順に count 件まで。 */
export function upcoming(schedule: Timing, after: number, count: number): Occurrence[] {
  const result: Occurrence[] = [];
  if (!schedule.weekdays.length) return result;
  // after の前日から見る（タイムゾーンの日付の境目をまたいでも取りこぼさない）
  let date = addDays(zonedDate(after, schedule.timeZone), -1);
  while (result.length < count) {
    const occurrence = occurrenceOn(schedule, date);
    if (occurrence && occurrence.startAt > after) result.push(occurrence);
    date = addDays(date, 1);
  }
  return result;
}

/** after より後にカウント開始する最初の回。曜日が 1 つもなければ null。 */
export function nextOccurrence(schedule: Timing, after: number): Occurrence | null {
  return upcoming(schedule, after, 1)[0] ?? null;
}

/**
 * now の時点で、カウント開始を迎えた回を片付ける（scheduler.ts が使う）。
 *   start  … セッションを作る回（休みの回と、締切を過ぎてしまった回は除く）
 *   next   … まだカウント開始していない最初の回。スケジュールの nextDate / nextStartAt にする
 *   skipDates … 片付けた回の日付を除いたもの
 * 定期実行が止まっていて何回分かたまっていても、締切前のものはすべて作る。
 */
export function planStarts(schedule: ScheduleData, now: number): {
  start: Occurrence[];
  next: Occurrence | null;
  skipDates: string[];
} {
  const start: Occurrence[] = [];
  let next = schedule.nextDate ? occurrenceOn(schedule, schedule.nextDate) : null;
  while (next && next.startAt <= now) {
    if (!schedule.skipDates.includes(next.date) && next.due > now) start.push(next);
    next = nextOccurrence(schedule, next.startAt);
  }
  // 過ぎた日の休みは要らない
  const nextDate = next?.date;
  const skipDates = nextDate ? schedule.skipDates.filter((date) => date >= nextDate) : [];
  return { start, next, skipDates };
}

/** スケジュールから作るセッションの ID。同じ回を 2 回作らないよう、日付から決める。 */
export function scheduledSessionId(scheduleId: string, date: string): string {
  return `${scheduleId}-${date.replaceAll('-', '')}`;
}

// ---- 表示用 ----

/** 「毎日」「平日」「月水金」の形。 */
export function weekdaysLabel(weekdays: readonly number[]): string {
  const days = [...new Set(weekdays)].sort();
  if (days.length === 7) return '毎日';
  if (days.join() === '1,2,3,4,5') return '平日';
  if (days.join() === '0,6') return '土日';
  return days.map((d) => WEEKDAYS[d]).join('');
}

/** 「9:00〜18:00」「22:00〜翌1:00」の形。 */
export function timeRangeLabel(schedule: Pick<ScheduleData, 'startMinutes' | 'dueMinutes'>): string {
  const next = schedule.dueMinutes <= schedule.startMinutes ? '翌' : '';
  return `${clock(schedule.startMinutes)}〜${next}${clock(schedule.dueMinutes)}`;
}

/** 「月水金 9:00〜18:00 に 2時間00分」の形。 */
export function scheduleSummary(schedule: Pick<ScheduleData, 'weekdays' | 'startMinutes' | 'dueMinutes' | 'requiredSec'>): string {
  return `${weekdaysLabel(schedule.weekdays)} ${timeRangeLabel(schedule)} に ${formatDuration(schedule.requiredSec)}`;
}

/** 「10/30（金）」の形。 */
export function dateLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WEEKDAYS[weekdayOf(date)]}）`;
}

/** "HH:MM" をその日の 0:00 からの分にする。形が正しくなければ null。 */
export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [h, m] = [Number(match[1]), Number(match[2])];
  return h < 24 && m < 60 ? h * 60 + m : null;
}

/** 分を "9:05" の形にする。 */
export function clock(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

// ---- 日付とタイムゾーン ----

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
