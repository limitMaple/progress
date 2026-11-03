// スケジュールからセッションを作る。各回のセッションは、取り消せる期限より前もって作っておく
// （いつ作るか・何を作るかは schedule.ts の Schedule）。作ったセッションは手で始めたものと同じで、精算も同じ（settle.ts）。
//
// セッションを作るのはトランザクションの中で行う。定期実行が重なっても、同じ回を 2 回作らない。

import { getFirestore } from 'firebase-admin/firestore';
import { loadAccount, schedulesRef, sessionsRef } from './store.ts';
import { dateLabel } from './calendar.ts';

/**
 * セッションを作る時刻を迎えた回のセッションを作り、次の回へ進める。作ったセッションの ID を返す。
 * Beeminder の設定が無ければ作らない（課金できない約束は始めない。startSession と同じ）。
 */
export async function createScheduledSessions(uid: string, scheduleId: string, now = Date.now()): Promise<string[]> {
  const { settings, tokens } = await loadAccount(uid);
  const canCharge = Boolean(tokens.beeminderToken && settings.beeminderUser);
  const ref = schedulesRef(uid).doc(scheduleId);

  return getFirestore().runTransaction(async (tx) => {
    const schedule = (await tx.get(ref)).data();
    if (!schedule || schedule.nextCreateAt == null || schedule.nextCreateAt > now) return [];

    const plan = schedule.planCreates(now);
    const sessions = plan.create.map((o) => schedule.sessionFor(o, now));
    const refs = sessions.map((s) => sessionsRef(uid).doc(s.id));
    const existing = refs.length ? await tx.getAll(...refs) : [];

    const created: string[] = [];
    if (canCharge) {
      sessions.forEach((session, i) => {
        // ID は回ごとに決まるので、もしあれば（取り消したものも）作り直さない
        if (existing[i].exists) return;
        tx.set(refs[i], session);
        created.push(session.id);
      });
    }

    const missed = canCharge ? [] : plan.create;
    tx.update(ref, {
      ...schedule.positionAt(plan.next),
      message: missed.length
        ? `${missed.map((o) => dateLabel(o.date)).join('、')}の回は、BeeminderのAPIトークンが未設定なので作りませんでした`
        : created.length ? '' : schedule.message,
    });
    return created;
  });
}
