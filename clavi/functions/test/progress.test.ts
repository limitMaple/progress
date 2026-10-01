import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trackedSeconds, resolveDeadline, sessionTitle, formatDuration, formatDay, formatDeadline,
} from '../src/progress.js';
import type { TimeEntry } from '../src/model.js';

const at = (hhmm: string) => new Date(`2026-09-16T${hhmm}:00`).getTime();
const iso = (hhmm: string) => new Date(at(hhmm)).toISOString();

function entry(start: string, stop: string | null, tags: string[] = [], project_id: number | null = null): TimeEntry {
  return stop
    ? { start: iso(start), stop: iso(stop), duration: (at(stop) - at(start)) / 1000, project_id, tags }
    : { start: iso(start), stop: null, duration: -at(start) / 1000, project_id, tags };
}

test('セッション開始前の分は数えない', () => {
  const entries = [entry('09:00', '11:00', ['study'])];
  const sec = trackedSeconds(entries, { from: at('10:00'), to: at('12:00'), tag: 'study' }, at('12:00'));
  assert.equal(sec, 3600);
});

test('タグ指定があれば他のタグは数えない', () => {
  const entries = [
    entry('10:00', '10:30', ['study']),
    entry('10:30', '11:00', ['work']),
    entry('11:00', '11:15', ['study', 'work']),
    { ...entry('11:15', '11:20'), tags: null },
  ];
  const range = { from: at('10:00'), to: at('12:00') };
  assert.equal(trackedSeconds(entries, { ...range, tag: 'study' }, at('12:00')), 45 * 60);
  assert.equal(trackedSeconds(entries, { ...range, tag: '' }, at('12:00')), 80 * 60);
});

test('プロジェクト指定があれば他のプロジェクトは数えない', () => {
  const entries = [
    entry('10:00', '10:30', [], 1),
    entry('10:30', '11:00', [], 2),
    entry('11:00', '11:10'),
  ];
  const range = { from: at('10:00'), to: at('12:00') };
  assert.equal(trackedSeconds(entries, { ...range, projectId: 1 }, at('12:00')), 30 * 60);
  assert.equal(trackedSeconds(entries, { ...range, projectId: null }, at('12:00')), 70 * 60);
});

test('プロジェクトとタグの両方を指定したら、両方を満たす記録だけ数える', () => {
  const entries = [
    entry('10:00', '10:30', ['study'], 1),
    entry('10:30', '11:00', ['work'], 1),
    entry('11:00', '11:20', ['study'], 2),
  ];
  const range = { from: at('10:00'), to: at('12:00') };
  assert.equal(trackedSeconds(entries, { ...range, projectId: 1, tag: 'study' }, at('12:00')), 30 * 60);
});

test('計測中の記録は now までを数える', () => {
  const entries = [entry('10:00', null, ['study'])];
  const sec = trackedSeconds(entries, { from: at('10:30'), to: at('11:15'), tag: 'study' }, at('11:15'));
  assert.equal(sec, 45 * 60);
});

test('締切（to）より後の分は数えない', () => {
  const entries = [entry('10:00', '13:00')];
  assert.equal(trackedSeconds(entries, { from: at('10:00'), to: at('12:00') }, at('14:00')), 7200);
});

test('締切の時刻が過ぎていれば翌日になる', () => {
  assert.equal(resolveDeadline('23:30', at('22:00')), at('23:30'));
  assert.equal(resolveDeadline('01:00', at('22:00')), at('01:00') + 86400000);
  assert.equal(resolveDeadline('22:00', at('22:00')), at('22:00') + 86400000);
});

test('セッションの名前', () => {
  assert.equal(sessionTitle({ projectName: '資格', tag: '過去問', requiredSec: 7200 }), '資格 / 過去問 2時間00分');
  assert.equal(sessionTitle({ projectName: '資格', tag: '', requiredSec: 2700 }), '資格 45分');
  assert.equal(sessionTitle({ projectName: '', tag: '', requiredSec: 2700 }), '作業 45分');
});

test('表示の整形', () => {
  assert.equal(formatDuration(45 * 60 + 59), '45分');
  assert.equal(formatDuration(3600 + 5 * 60), '1時間05分');
  assert.equal(formatDuration(-10), '0分');
  assert.equal(formatDay(at('23:00'), at('10:00')), '今日');
  assert.equal(formatDeadline(at('09:05'), at('08:00')), '9:05');
  assert.equal(formatDeadline(at('01:00') + 86400000, at('22:00')), '明日 1:00');
  assert.equal(formatDeadline(at('08:00') + 2 * 86400000, at('22:00')), '9/18 8:00');
});
