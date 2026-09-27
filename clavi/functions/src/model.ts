// Firestore に置くデータの形と、画面から呼ぶ関数の引数・戻り値。
// Web アプリ（clavi/lib, components）もここを import するので、Node や firebase-admin に依存しないこと。
//
//   users/{uid}                … Settings（本人も読める）
//   secrets/{uid}              … Tokens（Functions からしか読めない）
//   users/{uid}/sessions/{id}  … Session（本人も読める）
// 時刻はすべて epoch ms。

export interface Settings {
  defaultDollars: number;
  /** true なら Beeminder の dryrun で呼び、実際には課金しない */
  dryRun: boolean;
  /** Toggl のタグ名（入力補完用） */
  tags: string[];
  hasTogglToken: boolean;
  hasBeeminderToken: boolean;
  /** 課金 API の user_id に使う */
  beeminderUser: string;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultDollars: 10,
  // 本当に課金してよいと決めるまでは、Beeminder の dryrun で試せるようにしておく
  dryRun: true,
  tags: [],
  hasTogglToken: false,
  hasBeeminderToken: false,
  beeminderUser: '',
};

export interface Tokens {
  togglToken: string;
  beeminderToken: string;
}

export type SessionStatus = 'active' | 'done' | 'charged' | 'error';

export interface SettleState {
  attempts: number;
  /** 自動で再試行する予定の時刻。予定がなければ null */
  retryAt: number | null;
  message: string;
  at: number;
}

export interface ChargeRecord {
  /** Beeminder の charge ID。人が「課金されていた」と記録したときは空 */
  id: string;
  amount: number;
  at: number;
  dryRun: boolean;
  /** 人が Beeminder の履歴を見て記録したもの */
  manual: boolean;
}

/** 「締切までに指定の時間やる」という 1 件の約束。 */
export interface Session {
  id: string;
  title: string;
  /** 数える Toggl のタグ。空ならすべての記録 */
  tag: string;
  requiredSec: number;
  createdAt: number;
  due: number;
  dollars: number;
  status: SessionStatus;
  trackedSec: number;
  updatedAt: number | null;
  settle: SettleState | null;
  charge: ChargeRecord | null;
  /** 次に精算を試みる時刻。定期実行はこれを見て探す */
  checkAt: number | null;
  /** 精算に取りかかった時刻（ロック）。一定時間で切れる */
  claimedAt: number | null;
  /**
   * 課金 API を呼ぶ直前に立てる印。これがあって charge が無いものは
   * 「課金されたか分からない」状態で、人が確かめるまで自動では触らない
   */
  chargeRequestedAt: number | null;
  /** 精算で最初に測った作業時間。再試行ではこれを使い、Toggl を測り直さない */
  measuredSec: number | null;
}

/** Toggl の time entry のうち、進捗の計算に使う部分。 */
export interface TimeEntry {
  start: string;
  stop: string | null;
  /** 計測中は負の値 */
  duration: number;
  tags: string[] | null;
}

// ---- 画面から呼ぶ関数（Cloud Functions の callable） ----

export interface SaveSettingsRequest {
  /** 空欄なら変更しない */
  togglToken: string;
  /** 空欄なら変更しない */
  beeminderToken: string;
  defaultDollars: number;
  dryRun: boolean;
}

export interface SaveSettingsResponse {
  ok: boolean;
  message: string;
}

export interface StartSessionRequest {
  tag: string;
  requiredSec: number;
  due: number;
  dollars: number;
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
