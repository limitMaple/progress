// スケジュールからセッションを作るテスト。Firestore エミュレーターの中で動かす（clavi で `npm test`）。
// 外部 API は呼ばない。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { createScheduledSessions } from '../src/scheduler.ts';
import { saveChanges, schedulesRef, secretRef, sessionsRef, userRef } from '../src/store.ts';
import { Schedule } from '../src/schedule.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Firestore エミュレーターの中で動かしてください（clavi で npm test）');
}
initializeApp({ projectId: 'demo-toggl-ratchet' });

const jst = (s: string) => new Date(`${s}+09:00`).getTime();
// 金曜の 7:00。今日の回（9:00〜18:00）は 8:00 まで取り消せる
const NOW = jst('2026-10-30T07:00:00');

let seq = 0;

/** 平日 9:00〜18:00 に 2 時間、開始の 1 時間前まで取り消せるスケジュールを持つユーザー。 */
async function setup({ beeminder = true } = {}) {
  const uid = `sched-user${++seq}-${Date.now()}`;
  await userRef(uid).set({ beeminderUser: beeminder ? 'alice' : '' });
  await secretRef(uid).set({ togglToken: 'toggl', beeminderToken: beeminder ? 'bee' : '' });
  const schedule = Schedule.create({
    id: `schedule-${seq}`, now: NOW, project: { id: 1, name: '資格' }, tag: '過去問',
    requiredSec: 7200, dollars: 5,
    repeat: { kind: 'weekly', from: '2026-10-30', interval: 1, weekdays: [1, 2, 3, 4, 5] },
    startMinutes: 9 * 60, dueMinutes: 18 * 60, cancelMinutes: 60, timeZone: 'Asia/Tokyo',
  });
  await schedulesRef(uid).doc(schedule.id).set(schedule);
  return { uid, id: schedule.id };
}

const readSchedule = async (uid: string, id: string) => (await schedulesRef(uid).doc(id).get()).data()!;
const sessionIds = async (uid: string) => (await sessionsRef(uid).get()).docs.map((d) => d.id);

test('保存したスケジュールは Schedule として読める', async () => {
  const { uid, id } = await setup();
  const schedule = await readSchedule(uid, id);
  assert.ok(schedule instanceof Schedule);
  assert.equal(schedule.recurrence.label, '平日');
  assert.equal(schedule.nextDate, '2026-10-30');
});

test('作る時刻を迎えた回のセッションを、取り消せる期限つきで 1 回だけ作る', async () => {
  const { uid, id } = await setup();
  const created = await createScheduledSessions(uid, id, NOW);
  assert.deepEqual(created, [`${id}-20261030`]);
  // 同時に走っても、2 回目は作らない
  assert.deepEqual(await createScheduledSessions(uid, id, NOW), []);
  assert.deepEqual(await sessionIds(uid), created);

  const session = (await sessionsRef(uid).doc(created[0]).get()).data()!;
  assert.equal(session.status, 'active');
  assert.equal(session.startAt, jst('2026-10-30T09:00:00'));
  assert.equal(session.due, jst('2026-10-30T18:00:00'));
  assert.equal(session.cancelableUntil, jst('2026-10-30T08:00:00'));
  assert.equal(session.title, '資格 / 過去問 2時間00分');
  assert.equal(session.scheduleId, id);

  const schedule = await readSchedule(uid, id);
  assert.equal(schedule.nextDate, '2026-11-02');
  assert.equal(schedule.nextCreateAt, jst('2026-11-01T08:00:00'));
  // 月曜の回は、日曜の 8:00 になるまで作らない
  assert.deepEqual(await createScheduledSessions(uid, id, jst('2026-11-01T07:59:00')), []);
});

test('期限までなら取り消せ、取り消した回は作り直さない', async () => {
  const { uid, id } = await setup();
  const [sessionId] = await createScheduledSessions(uid, id, NOW);
  const ref = sessionsRef(uid).doc(sessionId);

  const late = (await ref.get()).data()!;
  assert.throws(() => late.cancel(jst('2026-10-30T08:00:00')), /期限を過ぎて/);

  const session = (await ref.get()).data()!;
  session.cancel(jst('2026-10-30T07:30:00'));
  await saveChanges(ref, session);
  const canceled = (await ref.get()).data()!;
  assert.equal(canceled.status, 'canceled');
  assert.equal(canceled.checkAt, null);
  assert.equal(canceled.isSettled, true);

  // 何かの拍子に同じ回をもう一度作ろうとしても、取り消したまま
  await schedulesRef(uid).doc(id).update({ nextDate: '2026-10-30', nextCreateAt: NOW });
  assert.deepEqual(await createScheduledSessions(uid, id, NOW), []);
  assert.equal((await ref.get()).data()!.status, 'canceled');
});

test('Beeminder が未設定なら作らずに、理由を残して次の回へ進める', async () => {
  const { uid, id } = await setup({ beeminder: false });
  assert.deepEqual(await createScheduledSessions(uid, id, NOW), []);
  const schedule = await readSchedule(uid, id);
  assert.equal(schedule.nextDate, '2026-11-02');
  assert.match(schedule.message, /10\/30（金）の回は、BeeminderのAPIトークンが未設定/);
  assert.deepEqual(await sessionIds(uid), []);
});
