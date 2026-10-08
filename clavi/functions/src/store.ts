// Firestore の読み書き。データの形は model.ts を参照。

import { getFirestore } from 'firebase-admin/firestore';
import type {
  DocumentData, DocumentReference, FirestoreDataConverter, Timestamp, WithFieldValue, WriteBatch,
} from 'firebase-admin/firestore';
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

/**
 * 読んだときの版（ドキュメントの updateTime）。保存するとき、読んでから誰も書き換えていないことを確かめるのに使う。
 * session.ts は Firestore に依存させないので、Session の外に持つ。
 */
const versions = new WeakMap<Session, Timestamp>();

/** 読むときは Session にし（版も覚える）、書くときはその項目をそのまま保存する。 */
const sessionConverter: FirestoreDataConverter<Session, SessionData> = {
  toFirestore: (session) => ({ ...session }) as WithFieldValue<SessionData>,
  fromFirestore: (snap) => {
    const session = new Session(snap.data() as SessionData);
    versions.set(session, snap.updateTime);
    return session;
  },
};

/** 読んでから保存するまでの間に、ほかの処理がセッションを書き換えていた。 */
export class ConflictError extends Error {
  constructor(id: string) {
    super(`ほかの処理がセッションを更新しました。やり直してください（${id}）`);
  }
}

/** Firestore の前提条件（lastUpdateTime）に合わなかったときのエラーか。 */
const isPreconditionFailure = (err: unknown) => (err as { code?: unknown }).code === 9;

function versionOf(session: Session): Timestamp {
  const version = versions.get(session);
  if (!version) throw new Error(`Firestore から読んでいないセッションは保存できません（${session.id}）`);
  return version;
}

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

export type SessionRef = DocumentReference<Session, SessionData>;

/**
 * Session の変わった項目だけを保存する。
 * 読んでからほかの処理が書き換えていたら保存せずに ConflictError を投げる（古い判断で上書きしない）。
 * それ以外で保存に失敗したら変更は残るので、もう一度呼べばやり直せる。
 */
export async function saveChanges(ref: SessionRef, session: Session): Promise<void> {
  const changes = session.changes;
  if (!Object.keys(changes).length) return;
  try {
    const result = await ref.update(changes, { lastUpdateTime: versionOf(session) });
    versions.set(session, result.writeTime);
  } catch (err) {
    throw isPreconditionFailure(err) ? new ConflictError(session.id) : err;
  }
  session.clearChanges();
}

/**
 * 複数のセッションの変更をまとめて保存する（saveChanges のまとめ版）。
 * 1 件でもほかの処理が書き換えていたら、どれも保存せずに ConflictError を投げる。
 */
export async function saveAllChanges(uid: string, sessions: readonly Session[]): Promise<void> {
  const changed = sessions.filter((s) => Object.keys(s.changes).length);
  if (!changed.length) return;
  const batch: WriteBatch = getFirestore().batch();
  for (const session of changed) {
    batch.update(sessionsRef(uid).doc(session.id), session.changes, { lastUpdateTime: versionOf(session) });
  }
  try {
    const results = await batch.commit();
    changed.forEach((session, i) => {
      versions.set(session, results[i].writeTime);
      session.clearChanges();
    });
  } catch (err) {
    throw isPreconditionFailure(err) ? new ConflictError(changed.map((s) => s.id).join(', ')) : err;
  }
}

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
 * ロックは時間で切れるが、切れたあとに元の処理が書こうとしても、版が変わっているので saveChanges が断る。
 */
export async function claimSettlement(
  uid: string,
  id: string,
  { resolving = false } = {},
): Promise<Session | null> {
  const ref = sessionsRef(uid).doc(id);
  const session = (await ref.get()).data();
  if (!session?.isClaimable(Date.now(), { resolving })) return null;
  session.claim(Date.now());
  try {
    // 読んだあとに誰かが書いていたら（先に権利を取られたなど）取れない
    await saveChanges(ref, session);
  } catch (err) {
    if (err instanceof ConflictError) return null;
    throw err;
  }
  return session;
}
