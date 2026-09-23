// 締切を過ぎたセッションの精算。達成していなければ Beeminder で自分に課金する。
// 課金するのはここだけ。必ず claimSettlement で権利を取ってから呼ぶこと。

import { loadAccount, sessionsRef } from './store.js';
import { beeminderClient } from './api.js';
import { syncSessions } from './sync.js';
import { formatDuration } from './progress.js';

const RETRY_DELAY = 60 * 1000;
const MAX_ATTEMPTS = 3;
// 締切ちょうどの記録も拾えるよう、少しだけ待ってから精算する
export const SETTLE_DELAY = 30 * 1000;

export const settleTime = (session) => session.settle?.retryAt ?? session.due + SETTLE_DELAY;

/**
 * セッションを 1 件精算する。
 * 進捗を取り直し、達成していなければ賭けた額を課金する。
 * 途中で失敗したら 1 分おきに最大 3 回まで試し、それでもだめなら status を 'error' にする。
 * （課金されたかどうか分からない状態を避けるため、失敗したぶんを後からまとめて課金はしない）
 * @returns {{ status: string, message: string }}
 */
export async function settleSession(uid, session) {
  const attempts = (session.settle?.attempts ?? 0) + 1;

  try {
    const synced = (await syncSessions(uid, [session.id])).synced[0] ?? session;
    if (synced.status === 'done') {
      return await finish(uid, session.id, attempts, 'done', {
        message: `達成しました（${formatDuration(synced.trackedSec)}）。課金はありません。`,
      });
    }

    const { settings, tokens } = await loadAccount(uid);
    if (!tokens.beeminderToken) throw new Error('BeeminderのAPIトークンが未設定です');
    const charge = await beeminderClient(tokens.beeminderToken).charge({
      user: settings.beeminderUser,
      amount: session.dollars,
      note: `Toggl Ratchet: ${session.title}`,
      dryrun: settings.dryRun,
    });
    const short = `${formatDuration(synced.trackedSec)} / ${formatDuration(session.requiredSec)}`;
    return await finish(uid, session.id, attempts, 'charged', {
      message: settings.dryRun
        ? `届きませんでした（${short}）。テストモードなので課金していません（$${session.dollars}）。`
        : `届きませんでした（${short}）。$${session.dollars}を課金しました。`,
      charge: {
        id: String(charge?.id ?? ''),
        amount: Number(charge?.amount ?? session.dollars),
        at: Date.now(),
        dryRun: Boolean(settings.dryRun),
      },
    });
  } catch (err) {
    const now = Date.now();
    const canRetry = attempts < MAX_ATTEMPTS;
    const message = canRetry
      ? `精算に失敗したので再試行します: ${err.message}`
      : `精算に失敗しました: ${err.message}`;
    await sessionsRef(uid).doc(session.id).update({
      status: 'error',
      settle: { attempts, retryAt: canRetry ? now + RETRY_DELAY : null, message, at: now },
      checkAt: canRetry ? now + RETRY_DELAY : null,
      claimedAt: null,
    });
    return { status: 'error', message };
  }
}

async function finish(uid, id, attempts, status, { message, charge = null }) {
  await sessionsRef(uid).doc(id).update({
    status,
    charge,
    settle: { attempts, retryAt: null, message, at: Date.now() },
    checkAt: null,
    claimedAt: null,
  });
  return { status, message };
}
