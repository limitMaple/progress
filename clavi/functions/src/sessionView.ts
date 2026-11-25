// セッションを画面に出す形にする（状態の名前・進み具合）。Session クラスは状態と決まりだけを持ち、表示はここに置く。
// Web アプリからも import するので、Node に依存しないこと。

import { formatDuration } from './format.ts';
import type { SessionData, SessionStatus } from './model.ts';

/** 表示用の状態。waiting は「カウント開始前の active」、settling は「締切を過ぎた active」（精算を待っている）。 */
export type DisplayStatus = SessionStatus | 'waiting' | 'settling';

type Progress = Pick<SessionData, 'trackedSec' | 'requiredSec'>;

export function displayStatus(
  { status, startAt, due }: Pick<SessionData, 'status' | 'startAt' | 'due'>,
  now: number,
): DisplayStatus {
  if (status !== 'active') return status;
  if (now >= due) return 'settling';
  return now < startAt ? 'waiting' : 'active';
}

/** 作業時間に対する進み具合（0〜1）。 */
export function progressRatio({ trackedSec, requiredSec }: Progress): number {
  return Math.min(1, trackedSec / requiredSec);
}

/** 「1時間05分 / 2時間00分」の形。 */
export function progressLabel({ trackedSec, requiredSec }: Progress): string {
  return `${formatDuration(trackedSec)} / ${formatDuration(requiredSec)}`;
}

/** カウント開始を指定したか（指定しなければ作成時刻と同じ）。 */
export function hasCustomStart({ startAt, createdAt }: Pick<SessionData, 'startAt' | 'createdAt'>): boolean {
  return startAt !== createdAt;
}
