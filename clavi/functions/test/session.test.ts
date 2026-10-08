import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.ts';
import type { SessionData } from '../src/model.ts';

const MIN = 60 * 1000;
const NOW = new Date('2026-09-16T12:00:00').getTime();

const start = () => Session.start({
  id: 'abcdefgh-1234', now: NOW, project: { id: 1, name: '資格' }, tag: '過去問',
  requiredSec: 3600, startAt: NOW, due: NOW + 120 * MIN, dollars: 5,
});

/** start() の一部の項目を変えたセッション。 */
const make = (data: Partial<SessionData>) => new Session({ ...start(), ...data });

test('start は active で、締切の少し後に精算を予定する', () => {
  const s = start();
  assert.equal(s.status, 'active');
  assert.equal(s.title, '資格 / 過去問 1時間00分');
  assert.equal(s.projectId, 1);
  assert.equal(s.checkAt, s.settleTime());
  assert.ok(s.settleTime() > s.due);
  assert.equal(s.hasCustomStart, false);
});


test('状態を変えるメソッドは自身を書き換え、変えた項目を changes に覚える', () => {
  const s = start();
  s.progress(1800, NOW);
  assert.equal(s.trackedSec, 1800);
  assert.equal(s.progressRatio, 0.5);
  assert.equal(s.progressLabel(), '30分 / 1時間00分');
  assert.deepEqual(s.changes, { trackedSec: 1800, updatedAt: NOW });
  // 覚えている変更は Firestore に保存する項目（{ ...session }）には入らない
  assert.equal(Object.keys({ ...s }).includes('changes'), false);
  assert.equal(Object.keys({ ...s }).length, Object.keys(start()).length);
  s.clearChanges();
  assert.deepEqual(s.changes, {});
});

test('締切を過ぎた active は「精算待ち」として見せる', () => {
  const s = start();
  assert.equal(s.displayStatus(NOW), 'active');
  assert.equal(s.displayStatus(s.due), 'settling');
  assert.equal(make({ status: 'charged' }).displayStatus(s.due), 'charged');
});

test('isClaimable: 精算済み・ロック中・課金されたか分からないものは取れない', () => {
  assert.equal(start().isClaimable(NOW), true);
  assert.equal(make({ status: 'done' }).isClaimable(NOW), false);
  assert.equal(make({ claimedAt: NOW - MIN }).isClaimable(NOW), false);
  assert.equal(make({ claimedAt: NOW - 10 * MIN }).isClaimable(NOW), true);

  const unknown = make({ status: 'error', chargeRequestedAt: NOW });
  assert.equal(unknown.isChargeUnknown, true);
  assert.equal(unknown.isClaimable(NOW), false);
  assert.equal(unknown.isClaimable(NOW, { resolving: true }), true);
  const charged = make({ status: 'error', chargeRequestedAt: NOW, charge: { id: 'c', amount: 5, at: NOW, manual: false } });
  assert.equal(charged.isChargeUnknown, false);
  assert.equal(charged.isClaimable(NOW, { resolving: true }), false);
});

test('chargeNote は ID の頭を入れる', () => {
  assert.equal(start().chargeNote(), 'Toggl Ratchet: 資格 / 過去問 1時間00分 (abcdefgh)');
});

test('progress: 締切前に届けば達成、締切後は届いていても達成にしない', () => {
  const before = start();
  before.progress(3600, NOW);
  assert.equal(before.status, 'done');
  assert.equal(before.checkAt, null);

  const after = start();
  after.progress(3600, after.due);
  assert.equal(after.status, 'active');
});

test('retryLater: 2 回までは status を変えずに予定し、3 回目で error にして止める', () => {
  const s = start();
  for (const attempts of [1, 2]) {
    s.retryLater('boom', NOW);
    assert.equal(s.status, 'active');
    assert.equal(s.settle?.attempts, attempts);
    assert.equal(s.checkAt, NOW + MIN);
    assert.equal(s.settleTime(), NOW + MIN);
  }
  s.retryLater('boom', NOW);
  assert.equal(s.status, 'error');
  assert.equal(s.settle?.attempts, 3);
  assert.equal(s.checkAt, null);
  assert.match(s.settle?.message ?? '', /精算に失敗しました: boom/);
});

test('retryLater: 保存できなかった課金の印は消す（課金 API は呼んでいない）', () => {
  const s = start();
  s.requestCharge(NOW);
  s.retryLater('boom', NOW);
  assert.equal(s.chargeRequestedAt, null);
  assert.equal(s.changes.chargeRequestedAt, null);
});

test('精算の結果: 課金済み・達成・人の確認待ちは、どれもロックと予定を外す', () => {
  const charged = make({ claimedAt: NOW, checkAt: NOW });
  charged.settleAsCharged(600, { id: 'c', amount: 5, at: NOW, manual: false });
  assert.equal(charged.status, 'charged');
  assert.equal(charged.settle?.message, '届きませんでした（10分 / 1時間00分）。$5を課金しました。');

  const done = make({ claimedAt: NOW, checkAt: NOW });
  done.settleAsDone(3600);
  const review = make({ claimedAt: NOW, checkAt: NOW });
  review.stopForReview('x');
  const manual = make({ claimedAt: NOW, checkAt: NOW });
  manual.settleAsChargedManually(NOW);

  for (const s of [charged, done, review, manual]) {
    assert.equal(s.claimedAt, null);
    assert.equal(s.checkAt, null);
  }
  assert.equal(done.status, 'done');
  assert.equal(review.status, 'error');
  assert.equal(manual.charge?.manual, true);
});

test('結果が出たあとなら、retryLater / stopForReview は何もしない（結果の保存をやり直す）', () => {
  const done = start();
  done.settleAsDone(3600);
  done.retryLater('write failed', NOW);
  assert.equal(done.status, 'done');
  assert.equal(done.settle?.message, '達成しました（1時間00分）。課金はありません。');
  assert.equal(done.changes.status, 'done');
  assert.equal(done.checkAt, null);

  const charged = start();
  charged.requestCharge(NOW);
  charged.settleAsCharged(600, { id: 'c', amount: 5, at: NOW, manual: false });
  charged.stopForReview('write failed');
  assert.equal(charged.status, 'charged');
  assert.equal(charged.charge?.id, 'c');
  assert.equal(charged.changes.status, 'charged');
});
