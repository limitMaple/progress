// 取り消し猶予（セッションをカウント開始の何分前まで取り消せるか）の決まり。
// 手で始めるセッション・スケジュールの各回・設定の画面が同じものを使う。
// Web アプリからも import するので、Node に依存しないこと。

import { formatDuration } from './format.ts';

const MIN = 60 * 1000;

/** 取り消し猶予の初めの値（カウント開始の 1 時間前まで取り消せる）。 */
export const DEFAULT_CANCEL_MINUTES = 60;

/** 取り消し猶予の上限。カウント開始の 1 週間前まで。 */
export const MAX_CANCEL_MINUTES = 7 * 24 * 60;

/** 取り消し猶予として使える分か。 */
export const isCancelMinutes = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_CANCEL_MINUTES;

/** カウント開始 startAt のセッションを取り消せる期限（この時刻より前なら取り消せる）。 */
export function cancelDeadline(startAt: number, cancelMinutes: number): number {
  return startAt - cancelMinutes * MIN;
}

/**
 * 今から始めるセッションの取り消せる期限。取り消せないなら null。
 * カウント開始を指定しない（startAt が null。始めた時刻から数える）か、期限がもう過ぎているなら取り消せない。
 */
export function cancelableUntilFor(startAt: number | null, cancelMinutes: number, now: number): number | null {
  if (startAt == null) return null;
  const deadline = cancelDeadline(startAt, cancelMinutes);
  return deadline > now ? deadline : null;
}

/** 「カウント開始の1時間00分前まで取り消せます」の形。 */
export function cancelLabel(cancelMinutes: number): string {
  return cancelMinutes > 0
    ? `カウント開始の${formatDuration(cancelMinutes * 60)}前まで取り消せます`
    : 'カウント開始まで取り消せます';
}
