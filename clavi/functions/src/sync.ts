// Toggl の記録で、締切前のセッションの進捗を計算して保存する。作業時間へ達していれば達成にする。
// 締切を過ぎたセッションの判定と課金はしない（それは settle.ts の仕事）。

import { loadAccount, sessionsRef, saveAllChanges } from './store.ts';
import { togglClient } from './api.ts';
import type { TimeEntry } from './model.ts';
import type { Session } from './session.ts';

const DAY = 24 * 60 * 60 * 1000;

interface SyncResult {
  /** 対象にしたセッション（更新後の値） */
  synced: Session[];
  /** そのうち今回達成になったもの */
  done: Session[];
}

/**
 * 締切前の進行中のセッションの進捗を更新する。ids を渡すとそのセッションだけを対象にする。
 * Toggl の取得に失敗したときは例外を投げる。
 */
export async function syncSessions(uid: string, ids?: readonly string[]): Promise<SyncResult> {
  const [{ tokens }, snap] = await Promise.all([
    loadAccount(uid),
    sessionsRef(uid).where('status', '==', 'active').get(),
  ]);
  // 締切を過ぎたものは精算（settle.ts）が測るので触らない（精算と同じセッションを書き合わないため）
  const now = Date.now();
  const targets = snap.docs.map((d) => d.data()).filter((s) => s.due > now && (!ids || ids.includes(s.id)));
  const result: SyncResult = { synced: [], done: [] };
  if (targets.length === 0) return result;
  if (!tokens.togglToken) throw new Error('TogglのAPIトークンが未設定です');

  const entries = await fetchTimeEntries(tokens.togglToken, targets, now);
  for (const session of targets) {
    // 締切より後は数えないので、締切後は値が動かない
    session.progress(session.measure(entries, now), now);
    result.synced.push(session);
    if (session.status === 'done') result.done.push(session);
  }
  // Toggl を待っている間に精算などが書き換えていたら、古い判断で上書きせずに ConflictError で止める
  await saveAllChanges(uid, targets);
  return result;
}

/** sessions を数えるのに要る範囲の Toggl の記録。 */
export async function fetchTimeEntries(
  togglToken: string,
  sessions: readonly Session[],
  now: number,
): Promise<TimeEntry[]> {
  // start_date は記録の開始時刻で絞られるので、カウント開始前から続く記録も拾えるよう広めに取る
  const from = Math.min(...sessions.map((s) => s.startAt)) - DAY;
  return togglClient(togglToken).timeEntries(new Date(from).toISOString(), new Date(now + DAY).toISOString());
}
