// セッションを始める・スケジュールを作る（create.ts）のテスト。Firestore エミュレーターの中で動かす（clavi で `npm test`）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { createSchedule, startSession } from '../src/create.ts';
import { schedulesRef, secretRef, sessionsRef, userRef } from '../src/store.ts';
import { InvalidInputError } from '../src/errors.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Firestore エミュレーターの中で動かしてください（clavi で npm test）');
}
initializeApp({ projectId: 'demo-toggl-ratchet' });

const jst = (s: string) => new Date(`${s}+09:00`).getTime();
// 水曜の 15:44。今日の 9:00 の回はもう過ぎている
const NOW = jst('2026-11-25T15:44:00');

let seq = 0;

/** 課金できる（Beeminder が設定済みの）ユーザー。 */
async function setup() {
  const uid = `create-user${++seq}-${Date.now()}`;
  await userRef(uid).set({ beeminderUser: 'alice', projects: [{ id: 1, name: '資格' }], cancelMinutes: 60 });
  await secretRef(uid).set({ togglToken: 'toggl', beeminderToken: 'bee' });
  return uid;
}

/** 画面から送られてくるのと同じ形のスケジュール。 */
const scheduleRequest = {
  projectId: null,
  tag: '',
  requiredSec: 7200,
  dollars: 5,
  repeat: { kind: 'weekly' as const, from: '2026-11-25', interval: 1, weekdays: [1, 3, 5] },
  startMinutes: 9 * 60,
  dueMinutes: 18 * 60,
  timeZone: 'Asia/Tokyo',
};

test('createSchedule: 画面から来た形のスケジュールを作って保存する', async () => {
  const uid = await setup();
  const id = await createSchedule(uid, scheduleRequest, NOW);
  const saved = (await schedulesRef(uid).doc(id).get()).data()!;
  assert.equal(saved.nextDate, '2026-11-27');
  assert.equal(saved.cancelMinutes, 60);
  assert.deepEqual(saved.repeat, scheduleRequest.repeat);
});

test('createSchedule: プロジェクトは設定にあるものだけ', async () => {
  const uid = await setup();
  const id = await createSchedule(uid, { ...scheduleRequest, projectId: 1 }, NOW);
  assert.equal((await schedulesRef(uid).doc(id).get()).data()!.projectName, '資格');
  await assert.rejects(createSchedule(uid, { ...scheduleRequest, projectId: 2 }, NOW), InvalidInputError);
});

test('startSession: セッションを作って保存し、作業時間を次の初期値にする', async () => {
  const uid = await setup();
  const id = await startSession(uid, {
    projectId: null, tag: '', requiredSec: 3600, startAt: null, due: NOW + 2 * 3600 * 1000, dollars: 5,
  }, NOW);
  assert.equal((await sessionsRef(uid).doc(id).get()).data()!.status, 'active');
  assert.equal((await userRef(uid).get()).data()!.lastRequiredSec, 3600);
});
