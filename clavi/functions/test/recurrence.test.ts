import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DailyRecurrence, MonthlyByDayRecurrence, MonthlyByWeekdayRecurrence, WeeklyRecurrence, recurrenceFrom, weekdaysLabel,
} from '../src/recurrence.ts';
import type { Recurrence } from '../src/recurrence.ts';
import { Temporal } from '../src/calendar.ts';

// 2026-10-30 は金曜、2026-11-01 は日曜

/** date から count 回分の日付。 */
function dates(r: Recurrence, date: string, count: number): string[] {
  const result: string[] = [];
  for (let d = first(r, date); d && result.length < count; d = r.firstOnOrAfter(d.add({ days: 1 }))) {
    result.push(d.toString());
  }
  return result;
}
const first = (r: Recurrence, date: string) => r.firstOnOrAfter(Temporal.PlainDate.from(date));

test('N 日ごと: 起点から数え、起点より前は回にしない', () => {
  const r = new DailyRecurrence({ from: '2026-10-30', interval: 3 });
  assert.deepEqual(dates(r, '2026-10-01', 3), ['2026-10-30', '2026-11-02', '2026-11-05']);
  assert.equal(first(r, '2026-11-02')?.toString(), '2026-11-02');
  assert.equal(r.label, '3日ごと');
  assert.equal(new DailyRecurrence({ from: '2026-10-30', interval: 1 }).label, '毎日');
});

test('N 週ごと: 起点を含む週（月曜から）を 1 週目として、interval 週ごとの曜日', () => {
  const r = new WeeklyRecurrence({ from: '2026-10-30', interval: 2, weekdays: [3, 1] });
  // 起点の週の月水は起点より前なので、次の次の週から
  assert.deepEqual(dates(r, '2026-10-30', 4), ['2026-11-09', '2026-11-11', '2026-11-23', '2026-11-25']);
  assert.equal(r.label, '2週間ごと 月水');
  assert.deepEqual(r.weekdays, [1, 3]);
});

test('毎週: 曜日の表示', () => {
  const weekly = (weekdays: number[]) => new WeeklyRecurrence({ from: '2026-10-30', interval: 1, weekdays }).label;
  assert.equal(weekly([1, 2, 3, 4, 5]), '平日');
  assert.equal(weekly([0, 6]), '土日');
  assert.equal(weekly([0, 1, 2, 3, 4, 5, 6]), '毎日');
  assert.equal(weekly([5, 1, 3]), '毎週 月水金');
  // 日曜は最後に並べる
  assert.equal(weekdaysLabel([0, 1]), '月日');
});

test('毎月の日付: その日が無い月は飛ばす', () => {
  const r = new MonthlyByDayRecurrence({ from: '2026-10-30', interval: 1, day: 31 });
  assert.deepEqual(dates(r, '2026-10-01', 3), ['2026-10-31', '2026-12-31', '2027-01-31']);
  assert.equal(r.label, '毎月31日');

  const every2 = new MonthlyByDayRecurrence({ from: '2026-10-30', interval: 2, day: 15 });
  // 10/15 は起点より前。次は 2 か月後
  assert.deepEqual(dates(every2, '2026-10-30', 2), ['2026-12-15', '2027-02-15']);
  assert.equal(every2.label, '2か月ごと 15日');

  // 2 月だけの 30 日は無い
  assert.equal(first(new MonthlyByDayRecurrence({ from: '2027-02-01', interval: 12, day: 30 }), '2027-02-01'), null);
});

test('毎月の第 N 曜日と、最後の曜日', () => {
  const second = new MonthlyByWeekdayRecurrence({ from: '2026-11-01', interval: 1, week: 2, weekday: 2 });
  assert.deepEqual(dates(second, '2026-11-01', 2), ['2026-11-10', '2026-12-08']);
  assert.equal(second.label, '毎月第2火曜');

  const last = new MonthlyByWeekdayRecurrence({ from: '2026-10-01', interval: 1, week: -1, weekday: 5 });
  assert.deepEqual(dates(last, '2026-10-01', 2), ['2026-10-30', '2026-11-27']);
  assert.equal(last.label, '毎月最終金曜');
});

test('recurrenceFrom: 保存した形から戻し、正しくない値は断る', () => {
  const r = recurrenceFrom({ kind: 'weekly', from: '2026-10-30', interval: 1, weekdays: [5, 1, 3] });
  assert.ok(r instanceof WeeklyRecurrence);
  assert.deepEqual(r.toData(), { kind: 'weekly', from: '2026-10-30', interval: 1, weekdays: [1, 3, 5] });

  assert.throws(() => recurrenceFrom({ kind: 'yearly' } as never), /種類/);
  assert.throws(() => recurrenceFrom({ kind: 'toString' } as never), /種類/);
  assert.throws(() => recurrenceFrom(undefined as never), /種類/);
  assert.throws(() => recurrenceFrom({ kind: 'weekly', from: '2026-10-30', interval: 1, weekdays: [] }), /曜日/);
  assert.throws(() => recurrenceFrom({ kind: 'daily', from: '2026-02-30', interval: 1 }), /起点/);
  assert.throws(() => recurrenceFrom({ kind: 'daily', from: '2026-10-30', interval: 0 }), /間隔/);
  assert.throws(() => recurrenceFrom({ kind: 'monthlyByDay', from: '2026-10-30', interval: 1, day: 32 }), /日は/);
  assert.throws(
    () => recurrenceFrom({ kind: 'monthlyByWeekday', from: '2026-10-30', interval: 1, week: 5, weekday: 1 }),
    /第何週/,
  );
});
