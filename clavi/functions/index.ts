// Web アプリから呼ぶ関数と、締切後の自動精算（定期実行）。
// Toggl / Beeminder の API はトークンを隠すため、すべてここから呼ぶ。

import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import {
  loadAccount, userRef, secretRef, sessionsRef, allSessions, claimSettlement,
} from './src/store.js';
import { syncSessions } from './src/sync.js';
import { settleSession, settleManually, settleTime } from './src/settle.js';
import { togglClient, beeminderClient } from './src/api.js';
import { sessionTitle } from './src/progress.js';
import { MAX_START_PAST_MS } from './src/model.js';
import type {
  ChargeResolution, LastInput, SaveSettingsRequest, SaveSettingsResponse, Session, SettleNowRequest,
  SettleResult, Settings, StartSessionRequest, StartSessionResponse, SyncNowResponse, Tokens,
} from './src/model.js';

initializeApp();
setGlobalOptions({ region: 'asia-northeast1', maxInstances: 5 });

// 定期実行は 1 分おきなので、1 分先までの分を拾い、その時刻まで待ってから精算する
const LOOKAHEAD = 60 * 1000;

/**
 * 画面から呼ぶ関数（callable）を作る。Firebase の onCall に 2 つを足したもの:
 *   - ログインしていない呼び出しを断る
 *   - handler が投げた例外を、画面にメッセージを出せる HttpsError に変える
 * data は画面から来た値そのままなので、handler の中で型と範囲を確かめること。
 */
function onAuthenticatedCall<Req, Res>(
  handler: (uid: string, data: Partial<Req>) => Promise<Res>,
) {
  return onCall<Partial<Req> | undefined, Promise<Res>>(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'ログインしてください');
    try {
      return await handler(request.auth.uid, request.data ?? {});
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error(err);
      throw new HttpsError('failed-precondition', (err as Error).message);
    }
  });
}

const invalid = (message: string) => new HttpsError('invalid-argument', message);

// ---- 設定 ----

export const saveSettings = onAuthenticatedCall<SaveSettingsRequest, SaveSettingsResponse>(
  async (uid, data) => {
    const settings: Partial<Settings> = {};

    // 空欄のトークンは「変更しない」
    const newTokens: Partial<Tokens> = {};
    for (const key of ['togglToken', 'beeminderToken'] as const) {
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
        const [me, tags, projects] = await Promise.all([toggl.me(), toggl.tags(), toggl.projects()]);
        settings.tags = [...new Set((tags ?? []).map((t) => t.name))].sort();
        // 選択肢には進行中のものだけ出す（アーカイブしたプロジェクトは選べなくてよい）
        settings.projects = (projects ?? [])
          .filter((p) => p.active)
          .map((p) => ({ id: p.id, name: p.name }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
        lines.push(
          `Toggl: 接続OK（${me.fullname || me.email}）。`
          + `プロジェクト${settings.projects.length}件、タグ${settings.tags.length}件を取得しました。`,
        );
      } catch (err) {
        ok = false;
        lines.push((err as Error).message);
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
        lines.push((err as Error).message);
      }
    }

    settings.hasTogglToken = Boolean(tokens.togglToken);
    settings.hasBeeminderToken = Boolean(tokens.beeminderToken);
    await userRef(uid).set(settings, { merge: true });

    return { ok, message: lines.join('\n') };
  },
);

// ---- セッションの開始 ----

export const startSession = onAuthenticatedCall<StartSessionRequest, StartSessionResponse>(
  async (uid, data) => {
    const now = Date.now();
    const tag = String(data.tag ?? '').trim();
    const projectId = data.projectId == null ? null : Number(data.projectId);
    const requiredSec = Math.floor(Number(data.requiredSec));
    // 数え始める時刻を指定しなければ、開始した時刻から数える
    const startAt = data.startAt == null ? now : Math.floor(Number(data.startAt));
    const due = Math.floor(Number(data.due));
    const dollars = Math.floor(Number(data.dollars));
    if (!(requiredSec > 0)) throw invalid('作業時間を入力してください');
    if (!(dollars >= 1)) throw invalid('金額は$1以上にしてください');
    if (!(due > now)) throw invalid('締切が過ぎています');
    if (!(startAt >= now - MAX_START_PAST_MS)) throw invalid('カウント開始は30日前までにしてください');
    if (!(due - startAt >= requiredSec * 1000)) throw invalid('カウント開始から締切までが、作業時間より短くなっています');

    const { settings, tokens } = await loadAccount(uid);
    if (!tokens.beeminderToken || !settings.beeminderUser) {
      throw invalid('BeeminderのAPIトークンが未設定です');
    }
    const project = projectId == null ? null : settings.projects.find((p) => p.id === projectId);
    if (project === undefined) {
      throw invalid('そのプロジェクトは選べません。設定を保存し直して、プロジェクトの一覧を取り直してください');
    }

    const draft: Omit<Session, 'checkAt'> = {
      id: randomUUID(),
      title: sessionTitle({ projectName: project?.name ?? '', tag, requiredSec }),
      projectId,
      projectName: project?.name ?? '',
      tag,
      requiredSec,
      createdAt: now,
      startAt,
      due,
      dollars,
      status: 'active',
      trackedSec: 0,
      updatedAt: null,
      settle: null,
      charge: null,
      claimedAt: null,
      chargeRequestedAt: null,
      measuredSec: null,
    };
    const session: Session = { ...draft, checkAt: settleTime(draft) };
    await sessionsRef(uid).doc(session.id).set(session);
    return { id: session.id };
  },
);

// ---- 入力欄の値の保存 ----

/** 整数に直し、範囲の外なら端に寄せる。数値でなければ fallback。 */
const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * 新しいセッションの入力欄に最後に入力した値を保存する。画面は入力が止まるたびに呼ぶ。
 * 次に入力欄を開いたときの初期値にするためだけのもので、何かを判定することはない。
 */
export const saveLastInput = onAuthenticatedCall<LastInput, void>(async (uid, data) => {
  const projectId = data.projectId == null ? null : clampInt(data.projectId, 0, Number.MAX_SAFE_INTEGER, 0);
  /** 形が合っていればそのまま、合っていなければ空欄 */
  const pick = (value: unknown, pattern: RegExp) => {
    const s = String(value ?? '');
    return pattern.test(s) ? s : '';
  };
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME = /^\d{2}:\d{2}$/;
  const lastInput: LastInput = {
    projectId: projectId || null,
    tag: String(data.tag ?? '').slice(0, 100),
    startDate: pick(data.startDate, DATE),
    startTime: pick(data.startTime, TIME),
    deadlineDate: pick(data.deadlineDate, DATE),
    deadlineTime: pick(data.deadlineTime, TIME),
    requiredSec: clampInt(data.requiredSec, 0, 99 * 3600, 0),
    dollars: clampInt(data.dollars, 0, 100_000, 0),
  };
  await userRef(uid).set({ lastInput }, { merge: true });
});

// ---- 手動の更新と精算 ----

export const syncNow = onAuthenticatedCall<void, SyncNowResponse>(async (uid) => {
  const result = await syncSessions(uid);
  return { done: result.done.map((s) => s.title) };
});

const RESOLUTIONS: readonly ChargeResolution[] = ['charged', 'not_charged'];
// セッション ID は randomUUID で作る。'/' などを通すと、Firestore の想定外のパスを指せてしまう
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * 締切を過ぎたのに精算できていないセッションを、画面から精算し直す。
 * 課金されたか分からないものは resolve で人の判断を受け取る。
 */
export const settleNow = onAuthenticatedCall<SettleNowRequest, SettleResult>(async (uid, data) => {
  const id = String(data.id ?? '');
  if (!SESSION_ID.test(id)) throw invalid('セッションの指定が正しくありません');
  const resolve = RESOLUTIONS.find((r) => r === data.resolve);
  if (data.resolve != null && !resolve) throw invalid('resolve の値が正しくありません');
  return settleManually(uid, id, resolve);
});

// ---- 締切後の自動精算 ----

export const autoSettle = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'Asia/Tokyo', timeoutSeconds: 300 },
  async () => {
    const snap = await allSessions().where('checkAt', '<=', Date.now() + LOOKAHEAD).get();

    await Promise.all(snap.docs.map(async (doc) => {
      // users/{uid}/sessions/{id} の uid
      const uid = doc.ref.parent.parent!.id;
      const session = await claimSettlement(uid, doc.id);
      if (!session) return;

      const wait = settleTime(session) - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

      const result = await settleSession(uid, session);
      logger.info('settled', { uid, id: session.id, status: result.status });
    }));
  },
);
