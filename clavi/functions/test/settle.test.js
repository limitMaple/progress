// 精算と同期のテスト。Firestore エミュレーターの中で動かす（clavi で `npm test`）。
// Toggl と Beeminder は fetch を差し替えて偽物にする。

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp } from 'firebase-admin/app';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Firestore エミュレーターの中で動かしてください（clavi で npm test）');
}
initializeApp({ projectId: 'demo-toggl-ratchet' });

const { settleSession, settleManually } = await import('../src/settle.js');
const { syncSessions } = await import('../src/sync.js');
const { claimSettlement, sessionsRef, userRef, secretRef } = await import('../src/store.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ---- 偽の Toggl / Beeminder ----

let togglEntries;
let togglFails;
let togglCalls;
let chargeFails;
let charges;

beforeEach(() => {
  togglEntries = [];
  togglFails = false;
  togglCalls = 0;
  chargeFails = null;
  charges = [];
});

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

globalThis.fetch = async (url, init = {}) => {
  const { host, pathname } = new URL(url);
  if (host === 'api.track.toggl.com') {
    togglCalls += 1;
    if (togglFails) throw new Error('getaddrinfo ENOTFOUND');
    return json(togglEntries);
  }
  if (pathname === '/api/v1/charges.json') {
    charges.push(Object.fromEntries(new URLSearchParams(String(init.body))));
    if (chargeFails === 'network') throw new Error('socket hang up');
    if (chargeFails === 'http') return json({ errors: { message: 'internal error' } }, 500);
    return json({ id: `ch_${charges.length}`, amount: 10, username: 'alice' });
  }
  throw new Error(`想定外の通信: ${url}`);
};

// ---- データの用意 ----

let seq = 0;

/** 新しいユーザーとセッションを 1 件作る。テストごとに別の uid にして干渉させない。 */
async function setup(overrides = {}, { dryRun = false } = {}) {
  const uid = `user${++seq}-${Date.now()}`;
  const now = Date.now();
  await userRef(uid).set({ beeminderUser: 'alice', dryRun });
  await secretRef(uid).set({ togglToken: 'toggl', beeminderToken: 'bee' });
  const session = {
    id: `session-${seq}-abcdefgh`,
    title: 'study 1時間00分',
    tag: '',
    requiredSec: 3600,
    createdAt: now - 2 * HOUR,
    due: now - MIN,
    dollars: 10,
    status: 'active',
    trackedSec: 0,
    updatedAt: null,
    settle: null,
    charge: null,
    checkAt: now - MIN,
    claimedAt: null,
    chargeRequestedAt: null,
    ...overrides,
  };
  await sessionsRef(uid).doc(session.id).set(session);
  return { uid, session };
}

const read = async (uid, id) => (await sessionsRef(uid).doc(id).get()).data();

/** start から minutes 分の、止まった記録。 */
function entry(start, minutes) {
  return {
    start: new Date(start).toISOString(),
    stop: new Date(start + minutes * MIN).toISOString(),
    duration: minutes * 60,
    tags: [],
  };
}

// ---- 精算 ----

test('未達なら 1 回だけ課金して charged にする', async () => {
  const { uid, session } = await setup();
  togglEntries = [entry(session.createdAt, 30)];

  const result = await settleSession(uid, session);

  assert.equal(result.status, 'charged');
  assert.equal(charges.length, 1);
  assert.equal(charges[0].amount, '10');
  assert.equal(charges[0].user_id, 'alice');
  assert.equal(charges[0].dryrun, undefined);
  const saved = await read(uid, session.id);
  assert.equal(saved.status, 'charged');
  assert.equal(saved.charge.id, 'ch_1');
  assert.equal(saved.checkAt, null);
  assert.equal(saved.claimedAt, null);
});

test('テストモードなら dryrun を付けて呼ぶ', async () => {
  const { uid, session } = await setup({}, { dryRun: true });

  await settleSession(uid, session);

  assert.equal(charges[0].dryrun, 'true');
  assert.equal((await read(uid, session.id)).charge.dryRun, true);
});

test('締切までに達していれば課金せず done にする', async () => {
  const { uid, session } = await setup();
  togglEntries = [entry(session.createdAt, 70)];

  const result = await settleSession(uid, session);

  assert.equal(result.status, 'done');
  assert.equal(charges.length, 0);
});

test('課金の前に失敗したら、課金せずに 1 分後の再試行を予約する', async () => {
  const { uid, session } = await setup();
  togglFails = true;

  const result = await settleSession(uid, session);

  assert.equal(result.status, 'active');
  assert.equal(charges.length, 0);
  const saved = await read(uid, session.id);
  assert.equal(saved.status, 'active');
  assert.ok(saved.checkAt > Date.now() + 50 * 1000);
  assert.equal(saved.settle.retryAt, saved.checkAt);
  assert.equal(saved.chargeRequestedAt ?? null, null);
});

test('3 回失敗したら error で止め、それ以上は予約しない', async () => {
  const { uid, session } = await setup({ settle: { attempts: 2, retryAt: Date.now() - 1000 } });
  togglFails = true;

  const result = await settleSession(uid, session);

  assert.equal(result.status, 'error');
  const saved = await read(uid, session.id);
  assert.equal(saved.checkAt, null);
  assert.equal(saved.settle.retryAt, null);
});

for (const failure of ['network', 'http']) {
  test(`課金 API が失敗したら（${failure}）、自動では課金し直さない`, async () => {
    const { uid, session } = await setup();
    chargeFails = failure;

    const result = await settleSession(uid, session);

    assert.equal(result.status, 'error');
    assert.equal(charges.length, 1);
    const saved = await read(uid, session.id);
    assert.ok(saved.chargeRequestedAt);
    assert.equal(saved.checkAt, null);
    // 定期実行はもう取れない
    assert.equal(await claimSettlement(uid, session.id), null);
  });
}

test('一度測った値があれば測り直さない（あとから足した記録で結果が変わらない）', async () => {
  const { uid, session } = await setup({ measuredSec: 30 * 60 });
  togglEntries = [entry(session.createdAt, 70)];

  const result = await settleSession(uid, session);

  assert.equal(result.status, 'charged');
  assert.equal(togglCalls, 0);
});

test('課金の前に失敗しても、測った値は残して再試行で使う', async () => {
  const { uid, session } = await setup();
  togglEntries = [entry(session.createdAt, 30)];
  await secretRef(uid).set({ togglToken: 'toggl', beeminderToken: '' });

  await settleSession(uid, session);

  const saved = await read(uid, session.id);
  assert.equal(saved.measuredSec, 30 * 60);
  assert.equal(saved.status, 'active');
  assert.equal(charges.length, 0);
});

test('同時に権利を取れるのは 1 つだけ', async () => {
  const { uid, session } = await setup();

  const claims = await Promise.all([1, 2, 3].map(() => claimSettlement(uid, session.id)));

  assert.equal(claims.filter(Boolean).length, 1);
});

// ---- 画面からの精算 ----

test('締切前の精算は、ロックを残さずに断る', async () => {
  const { uid, session } = await setup({ due: Date.now() + HOUR });

  await assert.rejects(settleManually(uid, session.id), /締切前/);

  assert.equal((await read(uid, session.id)).claimedAt, null);
});

test('課金されたか分からないものは、判断なしでは精算しない', async () => {
  const { uid, session } = await setup({ status: 'error', chargeRequestedAt: Date.now() - MIN });

  await assert.rejects(settleManually(uid, session.id), /確認が必要/);
  assert.equal(charges.length, 0);
});

test('「課金されていた」なら、課金せずに charged にする', async () => {
  const { uid, session } = await setup({ status: 'error', chargeRequestedAt: Date.now() - MIN });

  const result = await settleManually(uid, session.id, 'charged');

  assert.equal(result.status, 'charged');
  assert.equal(charges.length, 0);
  assert.equal((await read(uid, session.id)).charge.manual, true);
});

test('「課金されていなかった」なら、最初に測った値でもう一度精算する', async () => {
  const { uid, session } = await setup({
    status: 'error', chargeRequestedAt: Date.now() - MIN, measuredSec: 30 * 60,
  });
  togglEntries = [entry(session.createdAt, 70)];

  const result = await settleManually(uid, session.id, 'not_charged');

  assert.equal(result.status, 'charged');
  assert.equal(charges.length, 1);
  assert.equal(togglCalls, 0);
});

// ---- 同期 ----

test('締切後の同期では、後から足した記録で達成にならない', async () => {
  const { uid, session } = await setup();
  togglEntries = [entry(session.createdAt, 70)];

  await syncSessions(uid);

  const saved = await read(uid, session.id);
  assert.equal(saved.status, 'active');
  assert.equal(saved.trackedSec, 70 * 60);
});

test('締切前の同期では、達していれば done にする', async () => {
  const { uid, session } = await setup({ due: Date.now() + HOUR, checkAt: Date.now() + HOUR });
  togglEntries = [entry(session.createdAt, 70)];

  const result = await syncSessions(uid);

  assert.equal(result.done.length, 1);
  const saved = await read(uid, session.id);
  assert.equal(saved.status, 'done');
  assert.equal(saved.checkAt, null);
});
