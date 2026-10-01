// 締切を過ぎたセッションの精算。達成していなければ Beeminder で自分に課金する。
// 課金するのはここだけ。必ず claimSettlement で権利を取ってから呼ぶこと。
//
// 二重課金を防ぐため、課金 API を呼ぶ直前に chargeRequestedAt を保存する。
// それより後で失敗したら「課金されたか分からない」ので、自動では課金し直さず、
// 人が Beeminder の履歴を確かめて settleManually で決着をつける。
// （Beeminder の課金 API には、同じ依頼を 1 回分として扱う仕組みがない）

import type { DocumentReference } from 'firebase-admin/firestore';
import { loadAccount, sessionsRef, claimSettlement } from './store.js';
import { beeminderClient } from './api.js';
import { syncSessions } from './sync.js';
import { formatDuration } from './progress.js';
import type { ChargeRecord, ChargeResolution, Session, SessionStatus, SettleResult } from './model.js';

const RETRY_DELAY = 60 * 1000;
const MAX_ATTEMPTS = 3;
// 締切ちょうどの記録も拾えるよう、少しだけ待ってから精算する
const SETTLE_DELAY = 30 * 1000;

type SessionRef = DocumentReference<Session>;

/** 次に精算する時刻。再試行の予定があればそれ、なければ締切の少し後。 */
export const settleTime = (session: Pick<Session, 'settle' | 'due'>): number =>
  session.settle?.retryAt ?? session.due + SETTLE_DELAY;

/**
 * セッションを 1 件精算する。
 * 進捗を取り直し、達成していなければ賭けた額を課金する。
 * 課金の前に失敗したら 1 分おきに最大 3 回まで試し、それでもだめなら status を 'error' にする。
 * 課金に取りかかったあとで失敗したら、再試行せずに 'error' で止める。
 */
export async function settleSession(uid: string, session: Session): Promise<SettleResult> {
  const ref = sessionsRef(uid).doc(session.id);
  const attempts = (session.settle?.attempts ?? 0) + 1;
  // check: 判定中 → charging: 課金 API を呼んだ → charged: 課金 API が成功した
  let stage: 'check' | 'charging' | 'charged' = 'check';
  let charge: ChargeRecord | null = null;
  let message = '';

  try {
    // 締切後に一度測った値があればそれを使う。測り直すと、あとから Toggl に足した記録まで数えてしまう
    let trackedSec = session.measuredSec;
    if (trackedSec == null) {
      trackedSec = ((await syncSessions(uid, [session.id])).synced[0] ?? session).trackedSec;
      await ref.update({ measuredSec: trackedSec });
    }
    // sync は締切後に達成にしないので、到達したかはここで見る
    if (trackedSec >= session.requiredSec) {
      return await finish(ref, attempts, 'done', {
        message: `達成しました（${formatDuration(trackedSec)}）。課金はありません。`,
      });
    }

    const { settings, tokens } = await loadAccount(uid);
    if (!tokens.beeminderToken) throw new Error('BeeminderのAPIトークンが未設定です');

    await ref.update({ chargeRequestedAt: Date.now(), checkAt: null });
    stage = 'charging';
    const result = await beeminderClient(tokens.beeminderToken).charge({
      user: settings.beeminderUser,
      amount: session.dollars,
      // Beeminder の履歴と突き合わせられるよう、セッション ID の頭を入れておく
      note: `Toggl Ratchet: ${session.title} (${session.id.slice(0, 8)})`,
    });
    stage = 'charged';

    const short = `${formatDuration(trackedSec)} / ${formatDuration(session.requiredSec)}`;
    message = `届きませんでした（${short}）。$${session.dollars}を課金しました。`;
    charge = {
      id: String(result?.id ?? ''),
      amount: Number(result?.amount ?? session.dollars),
      at: Date.now(),
      manual: false,
    };
    return await finish(ref, attempts, 'charged', { message, charge });
  } catch (err) {
    const error = err as Error;
    if (stage === 'check') return retryLater(ref, session, attempts, error);
    if (stage === 'charged') {
      // 課金は通ったので、記録だけもう一度試す。これも失敗したら例外のまま上に返す
      // （chargeRequestedAt が立っているので、再び課金されることはない）
      return finish(ref, attempts, 'charged', { message, charge });
    }
    return stopForReview(ref, attempts, error);
  }
}

/** 課金の前に失敗した。締切後の処理なので status は変えず、少し後にやり直す。 */
async function retryLater(
  ref: SessionRef,
  session: Session,
  attempts: number,
  err: Error,
): Promise<SettleResult> {
  const now = Date.now();
  const canRetry = attempts < MAX_ATTEMPTS;
  const status: SessionStatus = canRetry ? session.status : 'error';
  const message = canRetry
    ? `精算に失敗したので、1分後にやり直します（${attempts}/${MAX_ATTEMPTS}）: ${err.message}`
    : `精算に失敗しました: ${err.message}`;
  const retryAt = canRetry ? now + RETRY_DELAY : null;
  await ref.update({
    status,
    settle: { attempts, retryAt, message },
    checkAt: retryAt,
    claimedAt: null,
  });
  return { status, message };
}

/** 課金 API の途中で失敗した。課金されたか分からないので、人が確かめるまで止める。 */
async function stopForReview(ref: SessionRef, attempts: number, err: Error): Promise<SettleResult> {
  const message = `課金されたか分かりません（${err.message}）。`
    + 'Beeminderの課金履歴を確かめて、画面から「課金されていた / いなかった」を選んでください。';
  await ref.update({
    status: 'error',
    settle: { attempts, retryAt: null, message },
    checkAt: null,
    claimedAt: null,
  });
  return { status: 'error', message };
}

async function finish(
  ref: SessionRef,
  attempts: number,
  status: SessionStatus,
  { message, charge = null }: { message: string; charge?: ChargeRecord | null },
): Promise<SettleResult> {
  await ref.update({
    status,
    charge,
    settle: { attempts, retryAt: null, message },
    checkAt: null,
    claimedAt: null,
  });
  return { status, message };
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

  const unresolved = Boolean(current.chargeRequestedAt) && !current.charge;
  if (unresolved && !resolve) throw new Error('課金されたかの確認が必要です');

  const session = await claimSettlement(uid, id, { resolving: unresolved });
  if (!session) throw new Error('このセッションは精算できません（処理中か、精算済みです）');
  const ref = sessionsRef(uid).doc(id);

  if (unresolved && resolve === 'charged') {
    return finish(ref, (session.settle?.attempts ?? 0) + 1, 'charged', {
      message: `課金済みとして記録しました（Beeminderの履歴で確認, $${session.dollars}）。`,
      charge: {
        id: '',
        amount: session.dollars,
        at: Date.now(),
        manual: true,
      },
    });
  }
  if (unresolved) {
    await ref.update({ chargeRequestedAt: null });
    return settleSession(uid, { ...session, chargeRequestedAt: null });
  }
  return settleSession(uid, session);
}
