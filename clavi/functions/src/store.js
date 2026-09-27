// Firestore の読み書き。
//   users/{uid}                … 設定（本人も読める）
//   secrets/{uid}              … API トークン（Functions からしか読めない）
//   users/{uid}/sessions/{id}  … セッション（本人も読める）

import { getFirestore } from 'firebase-admin/firestore';

export const DEFAULT_SETTINGS = {
  defaultDollars: 10,
  // 本当に課金してよいと決めるまでは、Beeminder の dryrun で試せるようにしておく
  dryRun: true,
  tags: [],
  hasTogglToken: false,
  hasBeeminderToken: false,
  beeminderUser: '',
};

// 精算が重なって二重に課金しないよう、取りかかったセッションはこの間ロックする
const CLAIM_TTL = 5 * 60 * 1000;

export const userRef = (uid) => getFirestore().doc(`users/${uid}`);
export const secretRef = (uid) => getFirestore().doc(`secrets/${uid}`);
export const sessionsRef = (uid) => userRef(uid).collection('sessions');

export async function loadAccount(uid) {
  const [user, secret] = await Promise.all([userRef(uid).get(), secretRef(uid).get()]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...user.data() },
    tokens: { togglToken: '', beeminderToken: '', ...secret.data() },
  };
}

/**
 * セッション = 「締切までに指定の時間やる」という 1 件の約束。
 * { id, title, tag, requiredSec, createdAt, due, dollars,
 *   status: 'active' | 'done' | 'charged' | 'error', trackedSec, updatedAt,
 *   settle: { attempts, retryAt, message, at }, charge: { id, amount, at, dryRun, manual },
 *   checkAt, claimedAt, chargeRequestedAt, measuredSec }
 * 時刻はすべて ms。checkAt は次に精算を試みる時刻で、定期実行はこれを見て探す。
 * measuredSec は精算で最初に測った作業時間。再試行ではこれを使い、Toggl を測り直さない。
 * chargeRequestedAt は課金 API を呼ぶ直前に立てる印で、立っていて charge が無いものは
 * 「課金されたか分からない」状態。人が確かめるまで自動では触らない。
 */

/**
 * 精算（締切を過ぎたセッションの判定と課金）に取りかかる権利を取る。
 * 取れたらセッションを返し、他の処理が持っているなら null を返す。
 * 定期実行と手動の精算が同時に走っても、課金が 2 回行われないようにするため。
 * 課金されたか分からないセッションは、resolving（人が確かめた）のときだけ取れる。
 */
export async function claimSettlement(uid, id, { resolving = false } = {}) {
  const ref = sessionsRef(uid).doc(id);
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const session = snap.data();
    const now = Date.now();
    if (!session) return null;
    if (session.charge) return null;
    if (session.status !== 'active' && session.status !== 'error') return null;
    if (session.chargeRequestedAt && !resolving) return null;
    if (session.claimedAt && now - session.claimedAt < CLAIM_TTL) return null;
    tx.update(ref, { claimedAt: now });
    return { ...session, claimedAt: now };
  });
}
