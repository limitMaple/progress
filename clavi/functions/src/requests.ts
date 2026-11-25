// 画面から呼ぶ関数（Cloud Functions の callable）の引数と戻り値。
// 名前は functions/index.ts の export と clavi/lib/firebase.ts に合わせる。
// Web アプリもここを import するので、Node や firebase-admin に依存しないこと。

import type { RecurrenceData, SessionStatus } from './model.ts';

export interface SaveSettingsRequest {
  /** 空欄なら変更しない */
  togglToken: string;
  /** 空欄なら変更しない */
  beeminderToken: string;
  /** 取り消し猶予（分）。null なら変更しない */
  cancelMinutes: number | null;
}

export interface SaveSettingsResponse {
  ok: boolean;
  message: string;
}

export interface StartSessionRequest {
  projectId: number | null;
  tag: string;
  requiredSec: number;
  /** 数え始める時刻。null なら開始した時刻から */
  startAt: number | null;
  due: number;
  dollars: number;
}

export interface CreateScheduleRequest {
  projectId: number | null;
  tag: string;
  requiredSec: number;
  dollars: number;
  repeat: RecurrenceData;
  startMinutes: number;
  dueMinutes: number;
  timeZone: string;
}

export interface CreateScheduleResponse {
  id: string;
}

/** セッションを取り消す。取り消せる期限より前だけ。 */
export interface CancelSessionRequest {
  id: string;
}

export interface StartSessionResponse {
  id: string;
}

export interface SyncNowResponse {
  /** 達成になったセッションのタイトル */
  done: string[];
}

/**
 * 課金されたか分からないセッションへの人の判断。
 *   charged     … Beeminder の履歴に課金があった。課金せずに課金済みにする
 *   not_charged … 履歴に課金がなかった。印を消してもう一度精算する
 */
export type ChargeResolution = 'charged' | 'not_charged';

export interface SettleNowRequest {
  id: string;
  resolve?: ChargeResolution;
}

export interface SettleResult {
  status: SessionStatus;
  message: string;
}
