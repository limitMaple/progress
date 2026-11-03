import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATE_AHEAD, Schedule, windowMinutes } from '../src/schedule.ts';
import { dateLabel, isDate, isTimeZone, zonedDate, zonedTime } from '../src/calendar.ts';
import type { ScheduleData } from '../src/model.ts';

const TOKYO = 'Asia/Tokyo';
/** Asia/Tokyo の壁時計の時刻。 */
const jst = (s: string) => new Date(`${s}+09:00`).getTime();
const HOUR = 3600 * 1000;

/** 平日 9:00〜18:00 に 2 時間、開始の 1 時間前まで取り消せる（Asia/Tokyo）。 */
const make = (data: Partial<ScheduleData> = {}) => new Schedule({
  id: 'sched-1',
  projectId: null,
  projectName: '',
  tag: '',
  requiredSec: 7200,
  dollars: 5,
  repeat: { kind: 'weekly', from: '2026-10-01', interval: 1, weekdays: [1, 2, 3, 4, 5] },
  startMinutes: 9 * 60,
  dueMinutes: 18 * 60,
  cancelMinutes: 60,
  timeZone: TOKYO,
  createdAt: 0,
  nextDate: null,
  nextCreateAt: null,
  message: '',
  ...data,
});

/** make() と同じ中身で、Schedule.create したもの。 */
const create = (now: number) => {
  const { id, tag, requiredSec, dollars, repeat, startMinutes, dueMinutes, cancelMinutes, timeZone } = make();
  return Schedule.create({
    id, now, project: null, tag, requiredSec, dollars, repeat, startMinutes, dueMinutes, cancelMinutes, timeZone,
  });
};

test('タイムゾーンの日付と時刻', () => {
  assert.equal(zonedTime('2026-10-30', 9 * 60, TOKYO), jst('2026-10-30T09:00:00'));
  // Asia/Tokyo の 8:00 は UTC では前日の 23:00
  assert.equal(zonedDate(jst('2026-10-30T08:00:00'), TOKYO), '2026-10-30');
  assert.equal(zonedDate(jst('2026-10-30T08:00:00'), 'UTC'), '2026-10-29');
  assert.equal(dateLabel('2026-10-30'), '10/30（金）');
  assert.equal(isDate('2026-02-28'), true);
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2026-2-28'), false);
  assert.equal(isTimeZone('Asia/Tokyo'), true);
  assert.equal(isTimeZone('Mars/Base'), false);
});

test('夏時間のあるタイムゾーンでも、壁時計の時刻どおりにする', () => {
  // 2026-11-01 に夏時間が終わる（ニューヨーク）
  const ny = 'America/New_York';
  assert.equal(zonedTime('2026-10-31', 9 * 60, ny), Date.parse('2026-10-31T09:00:00-04:00'));
  assert.equal(zonedTime('2026-11-02', 9 * 60, ny), Date.parse('2026-11-02T09:00:00-05:00'));
  const s = make({ timeZone: ny, startMinutes: 0, dueMinutes: 23 * 60 });
  const o = s.occurrenceAt('2026-11-01');
  assert.equal(o.due - o.startAt, 24 * HOUR);
  // 2026-03-08 は 2:00〜3:00 が無い。無い時刻は後ろへずらす
  assert.equal(zonedTime('2026-03-08', 2 * 60 + 30, ny), Date.parse('2026-03-08T03:30:00-04:00'));
  // 2026-11-01 は 1:00〜2:00 が 2 回ある。早いほうにする
  assert.equal(zonedTime('2026-11-01', 90, ny), Date.parse('2026-11-01T01:30:00-04:00'));
});

test('回の時刻・締切・取り消せる期限', () => {
  assert.deepEqual(make().occurrenceAt('2026-10-30'), {
    date: '2026-10-30',
    startAt: jst('2026-10-30T09:00:00'),
    due: jst('2026-10-30T18:00:00'),
    cancelableUntil: jst('2026-10-30T08:00:00'),
  });
});

test('締切が開始の時刻以前なら翌日', () => {
  const s = make({
    repeat: { kind: 'weekly', from: '2026-10-01', interval: 1, weekdays: [5] }, startMinutes: 22 * 60, dueMinutes: 60,
  });
  assert.equal(windowMinutes(s), 180);
  assert.equal(s.occurrenceAt('2026-10-30').due, jst('2026-10-31T01:00:00'));
  assert.equal(s.summary, '毎週 金 22:00〜翌1:00 に 2時間00分');
  assert.equal(make().summary, '平日 9:00〜18:00 に 2時間00分');
  assert.equal(make().cancelLabel, 'カウント開始の1時間00分前まで取り消せます');
  assert.equal(make({ cancelMinutes: 0 }).cancelLabel, 'カウント開始まで取り消せます');
});

test('upcoming: 回の日の、カウント開始が後のものから順に', () => {
  const s = make();
  // 金曜の 8:59。今日の回はまだ始まっていない
  assert.deepEqual(s.upcoming(jst('2026-10-30T08:59:00'), 3).map((o) => o.date),
    ['2026-10-30', '2026-11-02', '2026-11-03']);
  // 9:00 ちょうどは始まっている
  assert.equal(s.upcoming(jst('2026-10-30T09:00:00'), 1)[0].date, '2026-11-02');
});

test('create: 最初の回は、作った時点でまだ取り消せるもの', () => {
  // 7:00 なら今日の回（8:00 まで取り消せる）から。セッションはもう作ってよい
  const early = create(jst('2026-10-30T07:00:00'));
  assert.equal(early.nextDate, '2026-10-30');
  assert.equal(early.nextCreateAt, jst('2026-10-30T08:00:00') - CREATE_AHEAD);
  // 8:30 なら今日の回はもう取り消せないので、次の回から
  assert.equal(create(jst('2026-10-30T08:30:00')).nextDate, '2026-11-02');
});

test('planCreates: 作る時刻（取り消せる期限の 24 時間前）を迎えた回だけを作り、次の回へ進める', () => {
  const s = make({ nextDate: '2026-10-30' });
  assert.deepEqual(s.planCreates(jst('2026-10-29T07:59:00')).create, []);

  const plan = s.planCreates(jst('2026-10-29T08:00:00'));
  assert.deepEqual(plan.create.map((o) => o.date), ['2026-10-30']);
  // 月曜の回は、日曜の 8:00 に作る
  assert.equal(plan.next?.date, '2026-11-02');
  assert.equal(s.createAt(plan.next!), jst('2026-11-01T08:00:00'));
});

test('planCreates: 止まっていた間の回は、締切前のものだけ作る', () => {
  const plan = make({ nextDate: '2026-10-29' }).planCreates(jst('2026-10-30T10:00:00'));
  // 木曜の回は締切を過ぎているので作らない
  assert.deepEqual(plan.create.map((o) => o.date), ['2026-10-30']);
  assert.equal(plan.next?.date, '2026-11-02');
});

test('planCreates: 回がもう無ければ、次の回は null', () => {
  const s = make({
    repeat: { kind: 'monthlyByDay', from: '2027-02-01', interval: 12, day: 30 },
    nextDate: '2027-02-01',
  });
  assert.deepEqual(s.planCreates(jst('2027-02-28T10:00:00')), { create: [], next: null });
  assert.deepEqual(s.positionAt(null), { nextDate: null, nextCreateAt: null });
});

test('sessionFor: ID は回ごとに決まり、取り消せる期限を持つ', () => {
  const s = make();
  const now = jst('2026-10-29T08:00:00');
  const session = s.sessionFor(s.occurrenceAt('2026-10-30'), now);
  assert.equal(session.id, 'sched-1-20261030');
  assert.equal(session.scheduleId, 'sched-1');
  assert.equal(session.cancelableUntil, jst('2026-10-30T08:00:00'));
  assert.equal(session.displayStatus(now), 'waiting');
  assert.equal(session.isCancelable(now), true);
});

test('保存する項目に、作った Recurrence は入らない', () => {
  const s = make();
  assert.equal(s.recurrence.label, '平日');
  assert.deepEqual(Object.keys({ ...s }).sort(), Object.keys(make()).sort());
  assert.equal(Object.keys({ ...s }).includes('recurrence'), false);
});
