// Firestore に置くデータの形と、画面から呼ぶ関数の引数・戻り値。
// Web アプリ（clavi/lib, components）もここを import するので、Node や firebase-admin に依存しないこと。
//
//   users/{uid}                … Settings（本人も読める）
//   secrets/{uid}              … Tokens（Functions からしか読めない）
//   users/{uid}/sessions/{id}  … SessionData（本人も読める。振る舞いは session.ts の Session クラス）
// 時刻（〜At, due など）は epoch ms。

export interface Settings {
  /** Toggl のタグ名（入力補完用） */
  tags: string[];
  /** Toggl の進行中のプロジェクト（選択肢用） */
  projects: TogglProject[];
  hasTogglToken: boolean;
  hasBeeminderToken: boolean;
  /** 課金 API の user_id に使う */
  beeminderUser: string;
  /** 最後に開始したセッションの作業時間。新しいセッションの入力欄の初期値に使う */
  lastRequiredSec: number;
}

export const DEFAULT_SETTINGS: Settings = {
  tags: [],
  projects: [],
  hasTogglToken: false,
  hasBeeminderToken: false,
  beeminderUser: '',
  lastRequiredSec: 0,
};

export interface TogglProject {
  id: number;
  name: string;
}

export interface Tokens {
  togglToken: string;
  beeminderToken: string;
}

export type SessionStatus = 'active' | 'done' | 'charged' | 'error';

/** カウント開始を過去にできる限度。Toggl から取る記録の範囲が広がりすぎないようにする */
export const MAX_START_PAST_MS = 30 * 24 * 60 * 60 * 1000;

export interface SettleState {
  attempts: number;
  /** 自動で再試行する予定の時刻。予定がなければ null */
  retryAt: number | null;
  message: string;
}

export interface ChargeRecord {
  /** Beeminder の charge ID。人が「課金されていた」と記録したときは空 */
  id: string;
  amount: number;
  at: number;
  /** 人が Beeminder の履歴を見て記録したもの */
  manual: boolean;
}

/** 「締切までに指定の時間やる」という 1 件の約束の、保存する形。扱うときは session.ts の Session にする。 */
export interface SessionData {
  id: string;
  title: string;
  /** 数える Toggl のプロジェクト。null ならプロジェクトで絞らない */
  projectId: number | null;
  /** 表示用。開始したときのプロジェクト名 */
  projectName: string;
  /** 数える Toggl のタグ。空ならタグで絞らない（プロジェクトと両方あれば両方を満たす記録だけ） */
  tag: string;
  requiredSec: number;
  createdAt: number;
  /** Toggl の記録を数え始める時刻。開始時に指定しなければ createdAt と同じ */
  startAt: number;
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
  project_id: number | null;
  tags: string[] | null;
}

// ---- 画面から呼ぶ関数（Cloud Functions の callable） ----

export interface SaveSettingsRequest {
  /** 空欄なら変更しない */
  togglToken: string;
  /** 空欄なら変更しない */
  beeminderToken: string;
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
