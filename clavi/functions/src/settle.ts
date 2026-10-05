// 締切を過ぎたセッションの精算。達成していなければ Beeminder で自分に課金する。
// 課金するのはここだけ。必ず claimSettlement で権利を取ってから呼ぶこと。
//
// 二重課金を防ぐため、課金 API を呼ぶ直前に chargeRequestedAt を保存する。
// それより後で失敗したら「課金されたか分からない」ので、自動では課金し直さず、
// 人が Beeminder の履歴を確かめて settleManually で決着をつける。
// （Beeminder の課金 API には、同じ依頼を 1 回分として扱う仕組みがない）

import type { DocumentReference } from 'firebase-admin/firestore';
import { loadAccount, sessionsRef, claimSettlement } from './store.ts';
import { beeminderClient } from './api.ts';
import { syncSessions } from './sync.ts';
import type { ChargeResolution, SessionData, SettleResult } from './model.ts';
import type { Session, SessionPatch } from './session.ts';

type SessionRef = DocumentReference<Session, SessionData>;

/** 差分を保存して、精算の結果として返す。 */
async function save(ref: SessionRef, session: Session, patch: SessionPatch): Promise<SettleResult> {
  await ref.update(patch);
  const next = session.with(patch);
  return { status: next.status, message: next.settle?.message ?? '' };
}

/**
 * セッションを 1 件精算する。
 * 進捗を測り（一度測っていればその値を使い）、達成していなければ賭けた額を課金する。
 * 失敗したときの扱いは Session.retryLater / stopForReview を参照。
 */
export async function settleSession(uid: string, session: Session): Promise<SettleResult> {
  const ref = sessionsRef(uid).doc(session.id);
  // 課金 API を呼んだか。呼んだあとで失敗したら、課金し直さずに人の確認を待つ
  let chargeRequested = false;
  // 課金 API が成功したときの差分。保存に失敗したら、これだけもう一度保存する
  let charged: SessionPatch | null = null;

  try {
    // 締切後に一度測った値があればそれを使う。測り直すと、あとから Toggl に足した記録まで数えてしまう
    let trackedSec = session.measuredSec;
    if (trackedSec == null) {
      trackedSec = ((await syncSessions(uid, [session.id])).synced[0] ?? session).trackedSec;
      await ref.update({ measuredSec: trackedSec });
    }
    // sync は締切後に達成にしないので、届いたかはここで見る
    if (trackedSec >= session.requiredSec) return await save(ref, session, session.settleAsDone(trackedSec));

    const { settings, tokens } = await loadAccount(uid);
    if (!tokens.beeminderToken) throw new Error('BeeminderのAPIトークンが未設定です');

    await ref.update(session.requestCharge(Date.now()));
    chargeRequested = true;
    const result = await beeminderClient(tokens.beeminderToken).charge({
      user: settings.beeminderUser,
      amount: session.dollars,
      note: session.chargeNote(),
    });
    charged = session.settleAsCharged(trackedSec, {
      id: String(result?.id ?? ''),
      amount: Number(result?.amount ?? session.dollars),
      at: Date.now(),
      manual: false,
    });
    return await save(ref, session, charged);
  } catch (err) {
    const { message } = err as Error;
    // 課金は通ったので、記録だけもう一度試す。これも失敗したら例外のまま上に返す
    // （chargeRequestedAt が立っているので、再び課金されることはない）
    if (charged) return save(ref, session, charged);
    if (chargeRequested) return save(ref, session, session.stopForReview(message));
    return save(ref, session, session.retryLater(message, Date.now()));
  }
}

/**
 * 画面からの精算。締切後に止まっているセッションを片付ける。
 * 課金されたか分からないセッションは、resolve で人の判断を受け取る（model.ts の ChargeResolution）。
 */
export async function settleManually(
  uid: string,
  id: string,
  resolve?: ChargeResolution,
): Promise<SettleResult> {
  // 締切前は権利を取る前に弾く（取ってから弾くと、ロックが残って自動精算を邪魔する）
  const current = (await sessionsRef(uid).doc(id).get()).data();
  if (!current) throw new Error('セッションが見つかりません');
  if (Date.now() < current.due) throw new Error('締切前なので精算できません');

  const unresolved = current.isChargeUnknown;
  if (unresolved && !resolve) throw new Error('課金されたかの確認が必要です');

  const session = await claimSettlement(uid, id, { resolving: unresolved });
  if (!session) throw new Error('このセッションは精算できません（処理中か、精算済みです）');
  const ref = sessionsRef(uid).doc(id);

  if (unresolved && resolve === 'charged') {
    return save(ref, session, session.settleAsChargedManually(Date.now()));
  }
  if (unresolved) {
    await ref.update({ chargeRequestedAt: null });
    return settleSession(uid, session.with({ chargeRequestedAt: null }));
  }
  return settleSession(uid, session);
}
