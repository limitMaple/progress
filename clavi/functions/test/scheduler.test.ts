// スケジュールからセッションを作るテスト。Firestore エミュレーターの中で動かす（clavi で `npm test`）。
// 外部 API は呼ばない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { newSchedule, skipOccurrence, startScheduledSessions } from '../src/scheduler.ts';
import { schedulesRef, secretRef, sessionsRef, userRef } from '../src/store.ts';
import { scheduledSessionId } from '../src/schedule.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Firestore エミュレーターの中で動かしてください（clavi で npm test）');
}
initializeApp({ projectId: 'demo-toggl-ratchet' });

const jst = (s: string) => new Date(`${s}+09:00`).getTime();
// 金曜の 8:00。今日の回（9:00〜18:00）はまだ始まっていない
const NOW = jst('2026-10-30T08:00:00');

let seq = 0;

/** 平日 9:00〜18:00 に 2 時間のスケジュールを持つユーザー。 */
async function setup({ beeminder = true } = {}) {
  const uid = `sched-user${++seq}-${Date.now()}`;
  await userRef(uid).set({ beeminderUser: beeminder ? 'alice' : '' });
  await secretRef(uid).set({ togglToken: 'toggl', beeminderToken: beeminder ? 'bee' : '' });
  const schedule = newSchedule({
    id: `schedule-${seq}`, now: NOW, project: { id: 1, name: '資格' }, tag: '過去問',
    requiredSec: 7200, dollars: 5, weekdays: [1, 2, 3, 4, 5],
    startMinutes: 9 * 60, dueMinutes: 18 * 60, timeZone: 'Asia/Tokyo',
  });
  await schedulesRef(uid).doc(schedule.id).set(schedule);
  return { uid, id: schedule.id };
}

const readSchedule = async (uid: string, id: string) => (await schedulesRef(uid).doc(id).get()).data()!;
const sessionIds = async (uid: string) => (await sessionsRef(uid).get()).docs.map((d) => d.id);

test('作ったときは、まだ始まっていない最初の回を次の回にする', async () => {
  const { uid, id } = await setup();
  const schedule = await readSchedule(uid, id);
  assert.equal(schedule.nextDate, '2026-10-30');
  assert.equal(schedule.nextStartAt, jst('2026-10-30T09:00:00'));
});

test('カウント開始を迎えたら、その回のセッションを 1 回だけ作る', async () => {
  const { uid, id } = await setup();
  assert.deepEqual(await startScheduledSessions(uid, id, jst('2026-10-30T08:59:00')), []);

  const at = jst('2026-10-30T09:00:30');
  const created = await startScheduledSessions(uid, id, at);
  assert.deepEqual(created, [scheduledSessionId(id, '2026-10-30')]);
  // 同時に走っても、2 回目は作らない
  assert.deepEqual(await startScheduledSessions(uid, id, at), []);
  assert.deepEqual(await sessionIds(uid), created);

  const session = (await sessionsRef(uid).doc(created[0]).get()).data()!;
  assert.equal(session.status, 'active');
  assert.equal(session.startAt, jst('2026-10-30T09:00:00'));
  assert.equal(session.due, jst('2026-10-30T18:00:00'));
  assert.equal(session.title, '資格 / 過去問 2時間00分');
  assert.equal(session.scheduleId, id);
  assert.equal((await readSchedule(uid, id)).nextDate, '2026-11-02');
});

test('休んだ回は作らず、休みをやめれば作る', async () => {
  const { uid, id } = await setup();
  await skipOccurrence(uid, id, '2026-10-30', true, NOW);
  await skipOccurrence(uid, id, '2026-11-02', true, NOW);
  assert.deepEqual((await readSchedule(uid, id)).skipDates, ['2026-10-30', '2026-11-02']);

  assert.deepEqual(await startScheduledSessions(uid, id, jst('2026-10-30T09:01:00')), []);
  const schedule = await readSchedule(uid, id);
  assert.equal(schedule.nextDate, '2026-11-02');
  assert.deepEqual(schedule.skipDates, ['2026-11-02']);

  await skipOccurrence(uid, id, '2026-11-02', false, NOW);
  assert.equal((await startScheduledSessions(uid, id, jst('2026-11-02T09:01:00'))).length, 1);
});

test('カウント開始を過ぎた回は休めない', async () => {
  const { uid, id } = await setup();
  await assert.rejects(skipOccurrence(uid, id, '2026-10-30', true, jst('2026-10-30T09:00:00')), /変えられません/);
  // セッションを作ったあとの回も
  await startScheduledSessions(uid, id, jst('2026-10-30T09:00:30'));
  await assert.rejects(skipOccurrence(uid, id, '2026-10-30', true, jst('2026-10-30T08:00:00')), /変えられません/);
  // 曜日の合わない日
  await assert.rejects(skipOccurrence(uid, id, '2026-10-31', true, NOW), /曜日/);
});

test('Beeminder が未設定なら作らずに、理由を残して次の回へ進める', async () => {
  const { uid, id } = await setup({ beeminder: false });
  assert.deepEqual(await startScheduledSessions(uid, id, jst('2026-10-30T09:00:30')), []);
  const schedule = await readSchedule(uid, id);
  assert.equal(schedule.nextDate, '2026-11-02');
  assert.match(schedule.message, /10\/30（金）の回は、BeeminderのAPIトークンが未設定/);
  assert.deepEqual(await sessionIds(uid), []);
});
