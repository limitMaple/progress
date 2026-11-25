// 日付とタイムゾーンの計算。中身は Temporal（標準になる予定の日時 API。今はポリフィル）に任せ、
// ここは保存する形（日付 "YYYY-MM-DD"、時刻はその日の 0:00 からの分、epoch ms）との変換だけを持つ。
// Web アプリからも import するので、Node に依存しないこと。
// Functions は UTC で動くので、実行環境のタイムゾーンには頼らず、呼ぶ側がタイムゾーンを渡す。

import { Temporal } from 'temporal-polyfill';

export { Temporal };

export const WEEKDAYS = '日月火水木金土';

/** 曜日を 0 が日曜の数にする（Temporal は 1 が月曜、7 が日曜。保存する形は 0 が日曜）。 */
export function weekdayOf(date: Temporal.PlainDate): number {
  return date.dayOfWeek % 7;
}

/** "YYYY-MM-DD" の形で、実在する日付か。 */
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}

/** タイムゾーンの名前として使えるか。 */
export function isTimeZone(timeZone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** 「10/30（金）」の形。 */
export function dateLabel(date: string): string {
  const d = Temporal.PlainDate.from(date);
  return `${d.month}/${d.day}（${WEEKDAYS[weekdayOf(d)]}）`;
}

/** その日の 0:00 からの分として正しいか（0:00〜23:59）。 */
export const isMinuteOfDay = (n: number) => Number.isInteger(n) && n >= 0 && n < 24 * 60;

/** "HH:MM" をその日の 0:00 からの分にする。形が正しくなければ null。 */
export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [h, m] = [Number(match[1]), Number(match[2])];
  return h < 24 && m < 60 ? h * 60 + m : null;
}

/** その日の 0:00 からの分を「9:05」の形にする。 */
export function minuteOfDayLabel(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** 時刻 ms の、timeZone での日付 "YYYY-MM-DD"。 */
export function zonedDate(ms: number, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/**
 * timeZone での日付 date の minutes 分（その日の 0:00 から）を、時刻 ms にする。
 * 夏時間の切り替わりで、その時刻が無い日は後ろへずらし、2 回ある日は早いほうにする（Temporal の 'compatible'）。
 */
export function zonedTime(date: string, minutes: number, timeZone: string): number {
  const plainTime = new Temporal.PlainTime().add({ minutes });
  return Temporal.PlainDate.from(date)
    .toZonedDateTime({ timeZone, plainTime })
    .epochMilliseconds;
}
