import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelableUntilFor, cancelDeadline, cancelLabel, isCancelMinutes, MAX_CANCEL_MINUTES } from '../src/cancel.ts';

const MIN = 60 * 1000;
const NOW = new Date('2026-10-30T12:00:00+09:00').getTime();

test('取り消せる期限は、カウント開始の猶予ぶん前', () => {
  assert.equal(cancelDeadline(NOW + 120 * MIN, 60), NOW + 60 * MIN);
  assert.equal(cancelableUntilFor(NOW + 120 * MIN, 60, NOW), NOW + 60 * MIN);
});

test('カウント開始を指定しないか、期限がもう過ぎていれば取り消せない', () => {
  assert.equal(cancelableUntilFor(null, 60, NOW), null);
  assert.equal(cancelableUntilFor(NOW + 60 * MIN, 60, NOW), null);
  assert.equal(cancelableUntilFor(NOW, 0, NOW), null);
});

test('猶予として使える分', () => {
  assert.equal(isCancelMinutes(0), true);
  assert.equal(isCancelMinutes(MAX_CANCEL_MINUTES), true);
  assert.equal(isCancelMinutes(MAX_CANCEL_MINUTES + 1), false);
  assert.equal(isCancelMinutes(-1), false);
  assert.equal(isCancelMinutes(1.5), false);
});

test('猶予の文', () => {
  assert.equal(cancelLabel(60), 'カウント開始の1時間00分前まで取り消せます');
  assert.equal(cancelLabel(0), 'カウント開始まで取り消せます');
});
