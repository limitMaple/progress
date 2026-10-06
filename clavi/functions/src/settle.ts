// 締切を過ぎたセッションの精算。達成していなければ Beeminder で自分に課金する。
// 課金するのはここだけ。必ず claimSettlement で権利を取ってから呼ぶこと。
//
// 二重課金を防ぐため、課金 API を呼ぶ直前に chargeRequestedAt を保存する。
// それより後で失敗したら「課金されたか分からない」ので、自動では課金し直さず、
// 人が Beeminder の履歴を確かめて settleManually で決着をつける。
// （Beeminder の課金 API には、同じ依頼を 1 回分として扱う仕組みがない）

import { loadAccount, sessionsRef, claimSettlement, saveChanges } from './store.ts';
import { beeminderClient } from './api.ts';
import { syncSessions } from './sync.ts';
import type { ChargeResolution, SettleResult } from './model.ts';
import type { Session } from './session.ts';

const resultOf = (session: Session): SettleResult => ({
  status: session.status,
  message: session.settle?.message ?? '',
});

/**
 * セッションを 1 件精算する。
 * 進捗を測り（一度測っていればその値を使い）、達成していなければ賭けた額を課金する。
 * 失敗したときの扱いは Session.retryLater / stopForReview を参照。
 */
export async function settleSession(uid: string, session: Session): Promise<SettleResult> {
  const ref = sessionsRef(uid).doc(session.id);
  // 課金 API を呼んだか。呼んだあとで失敗したら、課金し直さずに人の確認を待つ
  let chargeRequested = false;
  // 課金 API が成功したか。そのあと保存に失敗したら、保存だけやり直す
  let charged = false;

  try {
    // 締切後に一度測った値があればそれを使う。測り直すと、あとから Toggl に足した記録まで数えてしまう
    let trackedSec = session.measuredSec;
    if (trackedSec == null) {
      trackedSec = ((await syncSessions(uid, [session.id])).synced[0] ?? session).trackedSec;
      session.recordMeasured(trackedSec);
      await saveChanges(ref, session);
    }
    // sync は締切後に達成にしないので、届いたかはここで見る
    if (trackedSec >= session.requiredSec) {
      session.settleAsDone(trackedSec);
      await saveChanges(ref, session);
      return resultOf(session);
    }

    const { settings, tokens } = await loadAccount(uid);
    if (!tokens.beeminderToken) throw new Error('BeeminderのAPIトークンが未設定です');

    session.requestCharge(Date.now());
    await saveChanges(ref, session);
    chargeRequested = true;
    const result = await beeminderClient(tokens.beeminderToken).charge({
      user: settings.beeminderUser,
      amount: session.dollars,
      note: session.chargeNote(),
    });
    charged = true;
    session.settleAsCharged(trackedSec, {
      id: String(result?.id ?? ''),
      amount: Number(result?.amount ?? session.dollars),
      at: Date.now(),
      manual: false,
    });
    await saveChanges(ref, session);
    return resultOf(session);
  } catch (err) {
    // 課金が通ったあとなら、残っている変更（課金済み）の保存だけをやり直す。これも失敗したら例外のまま上に返す
    // （chargeRequestedAt が立っているので、再び課金されることはない）
    if (!charged) {
      const { message } = err as Error;
      if (chargeRequested) session.stopForReview(message);
      else session.retryLater(message, Date.now());
    }
    await saveChanges(ref, session);
    return resultOf(session);
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

  if (unresolved && resolve === 'charged') {
    session.settleAsChargedManually(Date.now());
    await saveChanges(sessionsRef(uid).doc(id), session);
    return resultOf(session);
  }
  if (unresolved) {
    session.clearChargeRequest();
    await saveChanges(sessionsRef(uid).doc(id), session);
  }
  return settleSession(uid, session);
}
