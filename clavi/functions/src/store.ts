// Firestore の読み書き。データの形は model.ts を参照。

import { getFirestore } from 'firebase-admin/firestore';
import type { DocumentData, FirestoreDataConverter, WithFieldValue } from 'firebase-admin/firestore';
import { DEFAULT_SETTINGS } from './model.ts';
import type { SessionData, Settings, Tokens } from './model.ts';
import { Session } from './session.ts';

/** 型を付けるだけの変換。中身は Firestore に置いたそのまま。 */
function typed<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snap) => snap.data() as T,
  };
}

/** 読むときは Session にし、書くときはその項目をそのまま保存する。 */
const sessionConverter: FirestoreDataConverter<Session, SessionData> = {
  toFirestore: (session) => ({ ...session }) as WithFieldValue<SessionData>,
  fromFirestore: (snap) => new Session(snap.data() as SessionData),
};

// users/{uid} は保存した項目しか持たないので Partial。読むときは loadAccount で既定値と合わせる
export const userRef = (uid: string) =>
  getFirestore().doc(`users/${uid}`).withConverter(typed<Partial<Settings>>());
export const secretRef = (uid: string) =>
  getFirestore().doc(`secrets/${uid}`).withConverter(typed<Partial<Tokens>>());
export const sessionsRef = (uid: string) =>
  getFirestore().collection(`users/${uid}/sessions`).withConverter(sessionConverter);
/** すべてのユーザーのセッション（定期実行が探すとき用） */
export const allSessions = () =>
  getFirestore().collectionGroup('sessions').withConverter(sessionConverter);

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
 * 取れるかどうかは Session.isClaimable を参照。
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
    if (!session?.isClaimable(now, { resolving })) return null;
    tx.update(ref, { claimedAt: now });
    return session.with({ claimedAt: now });
  });
}
