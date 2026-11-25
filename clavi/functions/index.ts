// Web アプリから呼ぶ関数と、締切後の自動精算（定期実行）。
// Toggl / Beeminder の API はトークンを隠すため、すべてここから呼ぶ。

import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import {
  loadAccount, userRef, secretRef, sessionsRef, allSessions, claimSettlement, schedulesRef, allSchedules, saveChanges,
  hasUnsettledSession, canCharge,
} from './src/store.ts';
import { syncSessions } from './src/sync.ts';
import { settleSession, settleManually } from './src/settle.ts';
import { togglClient, beeminderClient } from './src/api.ts';
import { Session, validateSessionTerms } from './src/session.ts';
import { generateSessions } from './src/generate.ts';
import { Schedule } from './src/schedule.ts';
import { cancelableUntilFor, isCancelMinutes } from './src/cancel.ts';
import { InvalidInputError } from './src/errors.ts';
import type {
  CancelSessionRequest, ChargeResolution, CreateScheduleRequest, CreateScheduleResponse, RecurrenceData,
  SaveSettingsRequest, SaveSettingsResponse, SettleNowRequest, SettleResult, Settings, StartSessionRequest,
  StartSessionResponse, SyncNowResponse, Tokens,
} from './src/model.ts';

initializeApp();
setGlobalOptions({ region: 'asia-northeast1', maxInstances: 5 });

// 定期実行は 1 分おきなので、1 分先までの分を拾い、その時刻まで待ってから精算する
const LOOKAHEAD = 60 * 1000;

/**
 * 画面から呼ぶ関数（callable）を作る。Firebase の onCall に 2 つを足したもの:
 *   - ログインしていない呼び出しを断る
 *   - handler が投げた例外を、画面にメッセージを出せる HttpsError に変える
 *     （入力の誤りは InvalidInputError を投げれば invalid-argument になる）
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
      if (err instanceof InvalidInputError) throw new HttpsError('invalid-argument', err.message);
      logger.error(err);
      throw new HttpsError('failed-precondition', (err as Error).message);
    }
  });
}

// 未精算のセッションがある間は変えられない設定（走っている約束の条件を、あとから緩められないようにする）
const LOCKED_MESSAGE = '進行中か精算待ちのセッションがある間は、APIトークンと取り消し猶予は変えられません';
// セッションとスケジュールの ID は randomUUID で作る。'/' などを通すと、Firestore の想定外のパスを指せてしまう
const ID = /^[A-Za-z0-9-]{1,64}$/;

// ---- 設定 ----

export const saveSettings = onAuthenticatedCall<SaveSettingsRequest, SaveSettingsResponse>(
  async (uid, data) => {
    const settings: Partial<Settings> = {};
    const { settings: saved, tokens: savedTokens } = await loadAccount(uid);

    // 空欄のトークンは「変更しない」
    const newTokens: Partial<Tokens> = {};
    for (const key of ['togglToken', 'beeminderToken'] as const) {
      const value = String(data[key] ?? '').trim();
      if (value) newTokens[key] = value;
    }
    // null は「変更しない」。同じ値なら変更ではないので、ロック中でも保存できる（プロジェクトとタグの取り直し）
    const cancelMinutes = data.cancelMinutes == null ? null : Math.floor(Number(data.cancelMinutes));
    if (cancelMinutes != null && !isCancelMinutes(cancelMinutes)) {
      throw new InvalidInputError('取り消し猶予は、0以上の分で入力してください');
    }
    const changing = Object.keys(newTokens).length > 0 || (cancelMinutes != null && cancelMinutes !== saved.cancelMinutes);
    if (changing && await hasUnsettledSession(uid)) throw new InvalidInputError(LOCKED_MESSAGE);

    if (Object.keys(newTokens).length) await secretRef(uid).set(newTokens, { merge: true });
    const tokens = { ...savedTokens, ...newTokens };
    if (cancelMinutes != null) settings.cancelMinutes = cancelMinutes;

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

// ---- セッションの開始とスケジュールの作成（どちらも「約束」を作る） ----

/** 画面から来た、約束の中身のうちセッションとスケジュールで同じ項目。型だけそろえ、正しいかは各クラスが確かめる。 */
function readCommitment(data: Partial<StartSessionRequest | CreateScheduleRequest>) {
  return {
    projectId: data.projectId == null ? null : Number(data.projectId),
    tag: String(data.tag ?? '').trim(),
    requiredSec: Math.floor(Number(data.requiredSec)),
    dollars: Math.floor(Number(data.dollars)),
  };
}

/**
 * 約束を作れるアカウントか確かめ、設定と、数えるプロジェクトを返す。
 * 課金できない約束は作らない。プロジェクトは設定に控えた（Toggl で進行中の）ものだけ選べる。
 */
async function loadForCommitment(uid: string, projectId: number | null) {
  const account = await loadAccount(uid);
  if (!canCharge(account)) throw new InvalidInputError('BeeminderのAPIトークンが未設定です');
  const { settings } = account;
  const project = projectId == null ? null : settings.projects.find((p) => p.id === projectId);
  if (project === undefined) {
    throw new InvalidInputError('そのプロジェクトは選べません。設定を保存し直して、プロジェクトの一覧を取り直してください');
  }
  return { settings, project };
}

export const startSession = onAuthenticatedCall<StartSessionRequest, StartSessionResponse>(
  async (uid, data) => {
    const now = Date.now();
    const { projectId, tag, requiredSec, dollars } = readCommitment(data);
    // 数え始める時刻を指定しなければ、開始した時刻から数える
    const startAt = data.startAt == null ? null : Math.floor(Number(data.startAt));
    const due = Math.floor(Number(data.due));
    validateSessionTerms({ requiredSec, startAt, due, dollars }, now);

    const { settings, project } = await loadForCommitment(uid, projectId);
    const session = Session.start({
      id: randomUUID(), now, project, tag, requiredSec, startAt: startAt ?? now, due, dollars,
      cancelableUntil: cancelableUntilFor(startAt, settings.cancelMinutes, now),
    });
    await sessionsRef(uid).doc(session.id).set(session);
    // 次の入力欄の初期値にする
    await userRef(uid).set({ lastRequiredSec: requiredSec }, { merge: true });
    return { id: session.id };
  },
);

export const createSchedule = onAuthenticatedCall<CreateScheduleRequest, CreateScheduleResponse>(
  async (uid, data) => {
    const { projectId, ...commitment } = readCommitment(data);
    const { settings, project } = await loadForCommitment(uid, projectId);
    // 中身は Schedule.create が確かめる。取り消し猶予は設定のものを控える（スケジュールごとには決めない。
    // 控えるので、あとで設定が変わっても影響しない）
    const schedule = Schedule.create({
      id: randomUUID(),
      now: Date.now(),
      project,
      ...commitment,
      repeat: data.repeat as RecurrenceData,
      startMinutes: Number(data.startMinutes),
      dueMinutes: Number(data.dueMinutes),
      cancelMinutes: settings.cancelMinutes,
      timeZone: String(data.timeZone ?? ''),
    });
    await schedulesRef(uid).doc(schedule.id).set(schedule);
    return { id: schedule.id };
  },
);

// ---- セッションの取り消し ----

export const cancelSession = onAuthenticatedCall<CancelSessionRequest, void>(async (uid, data) => {
  const id = String(data.id ?? '');
  if (!ID.test(id)) throw new InvalidInputError('セッションの指定が正しくありません');
  const ref = sessionsRef(uid).doc(id);
  const session = (await ref.get()).data();
  if (!session) throw new InvalidInputError('セッションが見つかりません');
  session.cancel(Date.now());
  // 読んだあとに精算などが書き換えていたら、ConflictError で止まる
  await saveChanges(ref, session);
});

// ---- 手動の更新と精算 ----

export const syncNow = onAuthenticatedCall<void, SyncNowResponse>(async (uid) => {
  const result = await syncSessions(uid);
  return { done: result.done.map((s) => s.title) };
});

const RESOLUTIONS: readonly ChargeResolution[] = ['charged', 'not_charged'];

/**
 * 締切を過ぎたのに精算できていないセッションを、画面から精算し直す。
 * 課金されたか分からないものは resolve で人の判断を受け取る。
 */
export const settleNow = onAuthenticatedCall<SettleNowRequest, SettleResult>(async (uid, data) => {
  const id = String(data.id ?? '');
  if (!ID.test(id)) throw new InvalidInputError('セッションの指定が正しくありません');
  const resolve = RESOLUTIONS.find((r) => r === data.resolve);
  if (data.resolve != null && !resolve) throw new InvalidInputError('resolve の値が正しくありません');
  return settleManually(uid, id, resolve);
});

// ---- 締切後の自動精算 ----

export const autoSettle = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'Asia/Tokyo', timeoutSeconds: 300 },
  async () => {
    const snap = await allSessions().where('checkAt', '<=', Date.now() + LOOKAHEAD).get();

    // 1 件の失敗（ConflictError など）で、ほかのセッションの精算を止めない
    await Promise.allSettled(snap.docs.map(async (doc) => {
      // users/{uid}/sessions/{id} の uid
      const uid = doc.ref.parent.parent!.id;
      try {
        const session = await claimSettlement(uid, doc.id);
        if (!session) return;

        const wait = session.settleTime() - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

        const result = await settleSession(uid, session);
        logger.info('settled', { uid, id: session.id, status: result.status });
      } catch (err) {
        logger.error('settle failed', { uid, id: doc.id, err });
      }
    }));
  },
);

// ---- スケジュールからセッションを作る ----

export const generateScheduledSessions = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'Asia/Tokyo', timeoutSeconds: 120 },
  async () => {
    const snap = await allSchedules().where('nextCreateAt', '<=', Date.now()).get();

    // 1 件の失敗で、ほかのスケジュールを止めない
    await Promise.allSettled(snap.docs.map(async (doc) => {
      // users/{uid}/schedules/{id} の uid
      const uid = doc.ref.parent.parent!.id;
      try {
        const created = await generateSessions(uid, doc.id);
        if (created.length) logger.info('scheduled sessions created', { uid, schedule: doc.id, created });
      } catch (err) {
        logger.error('scheduled create failed', { uid, schedule: doc.id, err });
      }
    }));
  },
);
