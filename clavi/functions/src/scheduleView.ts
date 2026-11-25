// スケジュールを画面に出す形にする。Schedule クラスは回の計算だけを持ち、表示はここに置く。
// Web アプリからも import するので、Node に依存しないこと。

import { minuteOfDayLabel } from './calendar.ts';
import { formatDuration } from './format.ts';
import type { Schedule } from './schedule.ts';

/** 「9:00〜18:00」「22:00〜翌1:00」の形。 */
export function timeRangeLabel({ startMinutes, dueMinutes }: Pick<Schedule, 'startMinutes' | 'dueMinutes'>): string {
  const next = dueMinutes <= startMinutes ? '翌' : '';
  return `${minuteOfDayLabel(startMinutes)}〜${next}${minuteOfDayLabel(dueMinutes)}`;
}

/** 「毎週 月水金 9:00〜18:00 に 2時間00分」の形。 */
export function scheduleSummary(schedule: Schedule): string {
  return `${schedule.recurrence.label} ${timeRangeLabel(schedule)} に ${formatDuration(schedule.requiredSec)}`;
}
