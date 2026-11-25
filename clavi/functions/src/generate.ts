// スケジュールからセッションを作る。各回のセッションは、取り消せる期限より前もって作っておく
// （いつ作るか・何を作るかは schedule.ts の Schedule）。作ったセッションは手で始めたものと同じで、精算も同じ（settle.ts）。
//
// セッションを作るのはトランザクションの中で行う。定期実行が重なっても、同じ回を 2 回作らない。

import { getFirestore } from 'firebase-admin/firestore';
import { canCharge, loadAccount, schedulesRef, sessionsRef } from './store.ts';
import { dateLabel } from './calendar.ts';
import type { Occurrence } from './schedule.ts';

/** 課金できないので作らなかった回の知らせ。 */
const skippedMessage = (skipped: readonly Occurrence[]) =>
  `${skipped.map((o) => dateLabel(o.date)).join('、')}の回は、BeeminderのAPIトークンが未設定なので作りませんでした`;

/**
 * セッションを作る時刻を迎えた回のセッションを作り、次の回へ進める。作ったセッションの ID を返す。
 * Beeminder の設定が無ければ作らずに、理由をスケジュールに残す（課金できない約束は始めない。startSession と同じ）。
 */
export async function generateSessions(uid: string, scheduleId: string, now = Date.now()): Promise<string[]> {
  const chargeable = canCharge(await loadAccount(uid));
  const ref = schedulesRef(uid).doc(scheduleId);

  return getFirestore().runTransaction(async (tx) => {
    const schedule = (await tx.get(ref)).data();
    if (!schedule || schedule.nextCreateAt == null || schedule.nextCreateAt > now) return [];

    const { ready, next } = schedule.readyOccurrences(now);
    const advance = schedule.nextFieldsFor(next);
    if (!chargeable) {
      tx.update(ref, { ...advance, message: ready.length ? skippedMessage(ready) : schedule.message });
      return [];
    }

    const sessions = ready.map((o) => schedule.sessionFor(o, now));
    const refs = sessions.map((s) => sessionsRef(uid).doc(s.id));
    const existing = refs.length ? await tx.getAll(...refs) : [];
    // ID は回ごとに決まるので、もうあれば（取り消したものも）作り直さない
    const created = sessions.filter((_, i) => !existing[i].exists);
    created.forEach((session) => tx.set(sessionsRef(uid).doc(session.id), session));

    // 作れたなら、前に作れなかった知らせは消す
    tx.update(ref, { ...advance, message: created.length ? '' : schedule.message });
    return created.map((s) => s.id);
  });
}
