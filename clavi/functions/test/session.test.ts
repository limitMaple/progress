import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.ts';

const MIN = 60 * 1000;
const NOW = new Date('2026-09-16T12:00:00').getTime();

const start = () => Session.start({
  id: 'abcdefgh-1234', now: NOW, project: { id: 1, name: '資格' }, tag: '過去問',
  requiredSec: 3600, startAt: NOW, due: NOW + 120 * MIN, dollars: 5,
});

test('start は active で、締切の少し後に精算を予定する', () => {
  const s = start();
  assert.equal(s.status, 'active');
  assert.equal(s.title, '資格 / 過去問 1時間00分');
  assert.equal(s.projectId, 1);
  assert.equal(s.checkAt, s.settleTime());
  assert.ok(s.settleTime() > s.due);
  assert.equal(s.hasCustomStart, false);
});

test('with は元のセッションを変えずに、書き換えたものを返す', () => {
  const s = start();
  const t = s.with({ trackedSec: 1800 });
  assert.ok(t instanceof Session);
  assert.equal(s.trackedSec, 0);
  assert.equal(t.trackedSec, 1800);
  assert.equal(t.progressRatio, 0.5);
  assert.equal(t.progressLabel(), '30分 / 1時間00分');
});

test('締切を過ぎた active は「精算待ち」として見せる', () => {
  const s = start();
  assert.equal(s.displayStatus(NOW), 'active');
  assert.equal(s.displayStatus(s.due), 'settling');
  assert.equal(s.with({ status: 'charged' }).displayStatus(s.due), 'charged');
});

test('isClaimable: 精算済み・ロック中・課金されたか分からないものは取れない', () => {
  const s = start();
  assert.equal(s.isClaimable(NOW), true);
  assert.equal(s.with({ status: 'done' }).isClaimable(NOW), false);
  assert.equal(s.with({ claimedAt: NOW - MIN }).isClaimable(NOW), false);
  assert.equal(s.with({ claimedAt: NOW - 10 * MIN }).isClaimable(NOW), true);

  const unknown = s.with({ status: 'error', chargeRequestedAt: NOW });
  assert.equal(unknown.isChargeUnknown, true);
  assert.equal(unknown.isClaimable(NOW), false);
  assert.equal(unknown.isClaimable(NOW, { resolving: true }), true);
  const charged = unknown.with({ charge: { id: 'c', amount: 5, at: NOW, manual: false } });
  assert.equal(charged.isChargeUnknown, false);
  assert.equal(charged.isClaimable(NOW, { resolving: true }), false);
});

test('chargeNote は ID の頭を入れる', () => {
  assert.equal(start().chargeNote(), 'Toggl Ratchet: 資格 / 過去問 1時間00分 (abcdefgh)');
});

test('progress: 締切前に届けば達成、締切後は届いていても達成にしない', () => {
  const s = start();
  assert.deepEqual(s.progress(1800, NOW), { trackedSec: 1800, updatedAt: NOW });
  assert.equal(s.progress(3600, NOW).status, 'done');
  assert.equal(s.progress(3600, s.due).status, undefined);
});

test('retryLater: 2 回までは status を変えずに予定し、3 回目で error にして止める', () => {
  let s = start().with({ status: 'active' });
  for (const attempts of [1, 2]) {
    const patch = s.retryLater('boom', NOW);
    assert.equal(patch.status, undefined);
    assert.equal(patch.settle?.attempts, attempts);
    assert.equal(patch.checkAt, NOW + MIN);
    s = s.with(patch);
    assert.equal(s.settleTime(), NOW + MIN);
  }
  const last = s.retryLater('boom', NOW);
  assert.equal(last.status, 'error');
  assert.equal(last.settle?.attempts, 3);
  assert.equal(last.checkAt, null);
  assert.match(last.settle?.message ?? '', /精算に失敗しました: boom/);
});

test('精算の結果: 課金済み・達成・人の確認待ちは、どれもロックと予定を外す', () => {
  const s = start().with({ claimedAt: NOW, checkAt: NOW });
  const charged = s.settleAsCharged(600, { id: 'c', amount: 5, at: NOW, manual: false });
  assert.equal(charged.status, 'charged');
  assert.equal(charged.settle?.message, '届きませんでした（10分 / 1時間00分）。$5を課金しました。');
  for (const patch of [charged, s.settleAsDone(3600), s.stopForReview('x'), s.settleAsChargedManually(NOW)]) {
    assert.equal(patch.claimedAt, null);
    assert.equal(patch.checkAt, null);
  }
  assert.equal(s.stopForReview('x').status, 'error');
  assert.equal(s.settleAsChargedManually(NOW).charge?.manual, true);
});
