import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, nextOccurrence, occurrenceOn, planStarts, scheduleSummary, scheduledSessionId, upcoming,
  weekdayOf, windowMinutes, zonedDate, zonedTime,
} from '../src/schedule.ts';
import type { ScheduleData } from '../src/model.ts';

const TOKYO = 'Asia/Tokyo';
/** Asia/Tokyo の壁時計の時刻。 */
const jst = (s: string) => new Date(`${s}+09:00`).getTime();

/** 平日 9:00〜18:00 に 2 時間（Asia/Tokyo）。 */
const make = (data: Partial<ScheduleData> = {}): ScheduleData => ({
  id: 'sched-1',
  projectId: null,
  projectName: '',
  tag: '',
  requiredSec: 7200,
  dollars: 5,
  weekdays: [1, 2, 3, 4, 5],
  startMinutes: 9 * 60,
  dueMinutes: 18 * 60,
  timeZone: TOKYO,
  createdAt: 0,
  nextDate: null,
  nextStartAt: null,
  skipDates: [],
  message: '',
  ...data,
});

test('タイムゾーンの日付と時刻', () => {
  assert.equal(zonedTime('2026-10-30', 9 * 60, TOKYO), jst('2026-10-30T09:00:00'));
  // Asia/Tokyo の 8:00 は UTC では前日の 23:00
  assert.equal(zonedDate(jst('2026-10-30T08:00:00'), TOKYO), '2026-10-30');
  assert.equal(zonedDate(jst('2026-10-30T08:00:00'), 'UTC'), '2026-10-29');
  assert.equal(weekdayOf('2026-10-30'), 5);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('夏時間のあるタイムゾーンでも、壁時計の時刻どおりにする', () => {
  // 2026-11-01 に夏時間が終わる（ニューヨーク）
  const ny = 'America/New_York';
  assert.equal(zonedTime('2026-10-31', 9 * 60, ny), Date.parse('2026-10-31T09:00:00-04:00'));
  assert.equal(zonedTime('2026-11-02', 9 * 60, ny), Date.parse('2026-11-02T09:00:00-05:00'));
  const s = make({ timeZone: ny, weekdays: [0], startMinutes: 0, dueMinutes: 23 * 60 });
  const o = occurrenceOn(s, '2026-11-01')!;
  assert.equal(o.due - o.startAt, 24 * 3600 * 1000);
});

test('締切が開始の時刻以前なら翌日', () => {
  const s = make({ weekdays: [5], startMinutes: 22 * 60, dueMinutes: 60 });
  assert.equal(windowMinutes(s), 180);
  assert.deepEqual(occurrenceOn(s, '2026-10-30'), {
    date: '2026-10-30', startAt: jst('2026-10-30T22:00:00'), due: jst('2026-10-31T01:00:00'),
  });
  assert.equal(scheduleSummary(s), '金 22:00〜翌1:00 に 2時間00分');
  assert.equal(scheduleSummary(make()), '平日 9:00〜18:00 に 2時間00分');
});

test('upcoming: 曜日の合う回を、カウント開始が後のものから順に', () => {
  const s = make();
  // 金曜の 8:59。今日の回はまだ始まっていない
  assert.deepEqual(upcoming(s, jst('2026-10-30T08:59:00'), 3).map((o) => o.date),
    ['2026-10-30', '2026-11-02', '2026-11-03']);
  // 9:00 ちょうどは始まっている
  assert.equal(nextOccurrence(s, jst('2026-10-30T09:00:00'))?.date, '2026-11-02');
  assert.equal(nextOccurrence(make({ weekdays: [] }), 0), null);
});

test('planStarts: カウント開始を迎えた回だけを作り、次の回へ進める', () => {
  const s = make({ nextDate: '2026-10-30', nextStartAt: jst('2026-10-30T09:00:00') });
  assert.deepEqual(planStarts(s, jst('2026-10-30T08:59:00')).start, []);

  const plan = planStarts(s, jst('2026-10-30T09:00:30'));
  assert.deepEqual(plan.start.map((o) => o.date), ['2026-10-30']);
  assert.equal(plan.next?.date, '2026-11-02');
});

test('planStarts: 休む回は作らず、過ぎた休みは消す', () => {
  const s = make({
    nextDate: '2026-10-30',
    nextStartAt: jst('2026-10-30T09:00:00'),
    skipDates: ['2026-10-30', '2026-11-03'],
  });
  const plan = planStarts(s, jst('2026-10-30T09:01:00'));
  assert.deepEqual(plan.start, []);
  assert.equal(plan.next?.date, '2026-11-02');
  assert.deepEqual(plan.skipDates, ['2026-11-03']);
});

test('planStarts: 止まっていた間の回は、締切前のものだけ作る', () => {
  const s = make({ nextDate: '2026-10-29', nextStartAt: jst('2026-10-29T09:00:00') });
  const plan = planStarts(s, jst('2026-10-30T10:00:00'));
  // 木曜の回は締切を過ぎているので作らない
  assert.deepEqual(plan.start.map((o) => o.date), ['2026-10-30']);
  assert.equal(plan.next?.date, '2026-11-02');
});

test('セッションの ID は回ごとに決まる', () => {
  assert.equal(scheduledSessionId('sched-1', '2026-10-30'), 'sched-1-20261030');
});
