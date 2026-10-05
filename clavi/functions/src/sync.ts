// Toggl の記録で進捗を計算して保存する。締切前に作業時間へ達していれば達成にする。
// 課金はしない（それは settle.ts の仕事）。

import { getFirestore } from 'firebase-admin/firestore';
import type { UpdateData } from 'firebase-admin/firestore';
import { loadAccount, sessionsRef } from './store.js';
import { togglClient } from './api.js';
import { trackedSeconds } from './progress.js';
import type { Session } from './model.js';

const DAY = 24 * 60 * 60 * 1000;

interface SyncResult {
  /** 対象にしたセッション（更新後の値） */
  synced: Session[];
  /** そのうち今回達成になったもの */
  done: Session[];
}

/**
 * 進行中のセッションの進捗を更新する。ids を渡すとそのセッションだけを対象にする。
 * Toggl の取得に失敗したときは例外を投げる。
 */
export async function syncSessions(uid: string, ids?: readonly string[]): Promise<SyncResult> {
  const [{ tokens }, snap] = await Promise.all([
    loadAccount(uid),
    sessionsRef(uid).where('status', 'in', ['active', 'error']).get(),
  ]);
  const targets = snap.docs.map((d) => d.data()).filter((s) => !ids || ids.includes(s.id));
  const result: SyncResult = { synced: [], done: [] };
  if (targets.length === 0) return result;
  if (!tokens.togglToken) throw new Error('TogglのAPIトークンが未設定です');

  const now = Date.now();
  // start_date は記録の開始時刻で絞られるので、カウント開始前から続く記録も拾えるよう広めに取る
  const from = Math.min(...targets.map((s) => s.startAt)) - DAY;
  const entries = await togglClient(tokens.togglToken).timeEntries(
    new Date(from).toISOString(),
    new Date(now + DAY).toISOString(),
  );

  const batch = getFirestore().batch();
  for (const session of targets) {
    // カウント開始より前と締切より後は数えないので、締切後は値が動かない
    const trackedSec = trackedSeconds(
      entries,
      {
        from: session.startAt,
        to: Math.min(now, session.due),
        tag: session.tag,
        projectId: session.projectId,
      },
      now,
    );
    // 締切後は達成にしない。Toggl には過去の時刻で記録を足せるので、締切後に足した記録で
    // 課金を逃れられてしまう。締切後の判定は精算（settle.ts）だけが行う。
    const reached = trackedSec >= session.requiredSec && now < session.due;
    const patch: UpdateData<Session> = reached
      ? { trackedSec, updatedAt: now, status: 'done', checkAt: null }
      : { trackedSec, updatedAt: now };
    batch.update(sessionsRef(uid).doc(session.id), patch);

    const updated: Session = reached
      ? { ...session, trackedSec, updatedAt: now, status: 'done', checkAt: null }
      : { ...session, trackedSec, updatedAt: now };
    result.synced.push(updated);
    if (reached) result.done.push(updated);
  }

  await batch.commit();
  return result;
}
