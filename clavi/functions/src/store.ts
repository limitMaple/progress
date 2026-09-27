// Firestore の読み書き。データの形は model.ts を参照。

import { getFirestore } from 'firebase-admin/firestore';
import type { DocumentData, FirestoreDataConverter } from 'firebase-admin/firestore';
import { DEFAULT_SETTINGS } from './model.js';
import type { Session, Settings, Tokens } from './model.js';

// 精算が重なって二重に課金しないよう、取りかかったセッションはこの間ロックする
const CLAIM_TTL = 5 * 60 * 1000;

/** 型を付けるだけの変換。中身は Firestore に置いたそのまま。 */
function typed<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snap) => snap.data() as T,
  };
}

// users/{uid} は保存した項目しか持たないので Partial。読むときは loadAccount で既定値と合わせる
export const userRef = (uid: string) =>
  getFirestore().doc(`users/${uid}`).withConverter(typed<Partial<Settings>>());
export const secretRef = (uid: string) =>
  getFirestore().doc(`secrets/${uid}`).withConverter(typed<Partial<Tokens>>());
export const sessionsRef = (uid: string) =>
  getFirestore().collection(`users/${uid}/sessions`).withConverter(typed<Session>());
/** すべてのユーザーのセッション（定期実行が探すとき用） */
export const allSessions = () =>
  getFirestore().collectionGroup('sessions').withConverter(typed<Session>());

export async function loadAccount(uid: string): Promise<{ settings: Settings; tokens: Tokens }> {
  const [user, secret] = await Promise.all([userRef(uid).get(), secretRef(uid).get()]);
  return {
    settings: { ...DEFAULT_SETTINGS, ...user.data() },
    tokens: { togglToken: '', beeminderToken: '', ...secret.data() },
  };
}

/**
 * 精算（締切を過ぎたセッションの判定と課金）に取りかかる権利を取る。
 * 取れたらセッションを返し、他の処理が持っているなら null を返す。
 * 定期実行と手動の精算が同時に走っても、課金が 2 回行われないようにするため。
 * 課金されたか分からないセッションは、resolving（人が確かめた）のときだけ取れる。
 */
export async function claimSettlement(
  uid: string,
  id: string,
  { resolving = false } = {},
): Promise<Session | null> {
  const ref = sessionsRef(uid).doc(id);
  return getFirestore().runTransaction(async (tx) => {
    const session = (await tx.get(ref)).data();
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
