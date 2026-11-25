// 設定のロックに使う判定（hasUnsettledSession）のテスト。Firestore エミュレーターの中で動かす（clavi で `npm test`）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';
import { hasUnsettledSession, sessionsRef } from '../src/store.ts';
import { Session } from '../src/session.ts';
import type { SessionStatus } from '../src/model.ts';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Firestore エミュレーターの中で動かしてください（clavi で npm test）');
}
initializeApp({ projectId: 'demo-toggl-ratchet' });

const NOW = new Date('2026-10-30T12:00:00+09:00').getTime();
const HOUR = 60 * 60 * 1000;

let seq = 0;

/** 渡した状態のセッションだけを持つユーザー。 */
async function setup(statuses: SessionStatus[]) {
  const uid = `store-user${++seq}-${Date.now()}`;
  await Promise.all(statuses.map((status, i) => {
    const session = new Session({
      ...Session.start({
        id: `session-${i}`, now: NOW, project: null, tag: '過去問',
        requiredSec: 3600, startAt: NOW, due: NOW + 2 * HOUR, dollars: 5,
      }),
      status,
    });
    return sessionsRef(uid).doc(session.id).set(session);
  }));
  return uid;
}

test('セッションが無ければロックしない', async () => {
  assert.equal(await hasUnsettledSession(await setup([])), false);
});

test('精算が済んだセッションだけならロックしない', async () => {
  assert.equal(await hasUnsettledSession(await setup(['done', 'charged', 'canceled'])), false);
});

test('進行中か精算待ちのセッションが 1 件でもあればロックする', async () => {
  assert.equal(await hasUnsettledSession(await setup(['done', 'active'])), true);
  assert.equal(await hasUnsettledSession(await setup(['canceled', 'error'])), true);
});
