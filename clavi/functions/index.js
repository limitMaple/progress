// Web アプリから呼ぶ関数と、締切後の自動精算（定期実行）。
// Toggl / Beeminder の API はトークンを隠すため、すべてここから呼ぶ。

import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { loadAccount, userRef, secretRef, sessionsRef, claimSettlement } from './src/store.js';
import { syncSessions } from './src/sync.js';
import { settleSession, settleTime } from './src/settle.js';
import { togglClient, beeminderClient } from './src/api.js';
import { formatDuration } from './src/progress.js';

initializeApp();
setGlobalOptions({ region: 'asia-northeast1', maxInstances: 5 });

// 定期実行は 1 分おきなので、1 分先までの分を拾い、その時刻まで待ってから精算する
const LOOKAHEAD = 60 * 1000;

/** ログイン済みの呼び出しだけを通し、エラーはメッセージを画面に出せる形にする。 */
function callable(handler) {
  return onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'ログインしてください');
    try {
      return await handler(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error(err);
      throw new HttpsError('failed-precondition', err.message);
    }
  });
}

const invalid = (message) => new HttpsError('invalid-argument', message);

// ---- 設定 ----

export const saveSettings = callable(async (uid, data) => {
  const settings = {
    defaultDollars: Math.max(1, Math.floor(Number(data.defaultDollars) || 10)),
    dryRun: Boolean(data.dryRun),
  };

  // 空欄のトークンは「変更しない」
  const newTokens = {};
  for (const key of ['togglToken', 'beeminderToken']) {
    const value = String(data[key] ?? '').trim();
    if (value) newTokens[key] = value;
  }
  if (Object.keys(newTokens).length) await secretRef(uid).set(newTokens, { merge: true });
  const { tokens } = await loadAccount(uid);

  const lines = ['保存しました。'];
  let ok = true;

  if (tokens.togglToken) {
    try {
      const toggl = togglClient(tokens.togglToken);
      const [me, tags] = await Promise.all([toggl.me(), toggl.tags()]);
      settings.tags = [...new Set((tags ?? []).map((t) => t.name))].sort();
      lines.push(`Toggl: 接続OK（${me.fullname || me.email}）。タグ${settings.tags.length}件を取得しました。`);
    } catch (err) {
      ok = false;
      lines.push(err.message);
    }
  }

  if (tokens.beeminderToken) {
    try {
      // 課金には user_id が要るので、ここで控えておく
      const me = await beeminderClient(tokens.beeminderToken).me();
      settings.beeminderUser = me.username;
      lines.push(`Beeminder: 接続OK（${me.username}）`);
    } catch (err) {
      ok = false;
      lines.push(err.message);
    }
  }

  settings.hasTogglToken = Boolean(tokens.togglToken);
  settings.hasBeeminderToken = Boolean(tokens.beeminderToken);
  await userRef(uid).set(settings, { merge: true });

  return { ok, message: lines.join('\n') };
});

// ---- セッションの開始 ----

export const startSession = callable(async (uid, data) => {
  const now = Date.now();
  const tag = String(data.tag ?? '').trim();
  const requiredSec = Math.floor(Number(data.requiredSec));
  const due = Math.floor(Number(data.due));
  const dollars = Math.floor(Number(data.dollars));
  if (!(requiredSec > 0)) throw invalid('作業時間を入力してください');
  if (!(dollars >= 1)) throw invalid('金額は$1以上にしてください');
  if (!(due - now >= requiredSec * 1000)) throw invalid('締切までに作業時間が足りません');

  const { settings, tokens } = await loadAccount(uid);
  if (!tokens.beeminderToken || !settings.beeminderUser) {
    throw invalid('BeeminderのAPIトークンが未設定です');
  }

  const session = {
    id: randomUUID(),
    title: `${tag || '作業'} ${formatDuration(requiredSec)}`,
    tag,
    requiredSec,
    createdAt: now,
    due,
    dollars,
    status: 'active',
    trackedSec: 0,
    updatedAt: null,
    settle: null,
    charge: null,
    claimedAt: null,
  };
  session.checkAt = settleTime(session);
  await sessionsRef(uid).doc(session.id).set(session);
  return { id: session.id };
});

// ---- 手動の更新 ----

export const syncNow = callable(async (uid) => {
  const result = await syncSessions(uid);
  return { done: result.done.map((s) => s.title) };
});

/** 締切を過ぎたのに精算できていないセッションを、画面から精算し直す。 */
export const settleNow = callable(async (uid, data) => {
  const id = String(data.id ?? '');
  const session = await claimSettlement(uid, id);
  if (!session) throw invalid('このセッションは精算できません（処理中か、精算済みです）');
  if (Date.now() < session.due) throw invalid('締切前なので精算できません');
  return settleSession(uid, session);
});

// ---- 締切後の自動精算 ----

export const autoSettle = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'Asia/Tokyo', timeoutSeconds: 300 },
  async () => {
    const snap = await getFirestore().collectionGroup('sessions')
      .where('checkAt', '<=', Date.now() + LOOKAHEAD)
      .get();

    await Promise.all(snap.docs.map(async (doc) => {
      const uid = doc.ref.parent.parent.id;
      const session = await claimSettlement(uid, doc.id);
      if (!session) return;

      const wait = settleTime(session) - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

      const result = await settleSession(uid, session);
      logger.info('settled', { uid, id: session.id, status: result.status });
    }));
  },
);
