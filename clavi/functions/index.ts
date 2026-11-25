// Cloud Functions の入り口。画面から呼ぶ関数（callable）と、1 分おきの定期実行をここで公開する。
// ここは「ログインの確認・画面から来た値を型にそろえる・処理を呼ぶ・エラーを画面向けにする」だけを持ち、
// 処理の中身は src/ の各モジュールに置く（設定 settings.ts、約束を作る create.ts、精算 settle.ts など）。
// Toggl / Beeminder の API はトークンを隠すため、すべて Functions から呼ぶ。

import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { sessionsRef, allSessions, claimSettlement, allSchedules, saveChanges } from './src/store.ts';
import { syncSessions } from './src/sync.ts';
import { settleSession, settleManually } from './src/settle.ts';
import { generateSessions } from './src/generate.ts';
import { saveSettings as saveAccountSettings } from './src/settings.ts';
import { createSchedule as createNewSchedule, startSession as startNewSession } from './src/create.ts';
import { InvalidInputError } from './src/errors.ts';
import type {
  CancelSessionRequest, ChargeResolution, CreateScheduleRequest, CreateScheduleResponse, SaveSettingsRequest,
  SaveSettingsResponse, SettleNowRequest, SettleResult, StartSessionRequest, StartSessionResponse, SyncNowResponse,
} from './src/requests.ts';
import type { RecurrenceData, Tokens } from './src/model.ts';

initializeApp();
setGlobalOptions({ region: 'asia-northeast1', maxInstances: 5 });

// 定期実行は 1 分おきなので、1 分先までの分を拾い、その時刻まで待ってから精算する
const LOOKAHEAD = 60 * 1000;

/**
 * 画面から呼ぶ関数（callable）を作る。Firebase の onCall に 2 つを足したもの:
 *   - ログインしていない呼び出しを断る
 *   - handler が投げた例外を、画面にメッセージを出せる HttpsError に変える
 *     （入力の誤りは InvalidInputError を投げれば invalid-argument になる）
 * data は画面から来た値そのままなので、handler の中で型をそろえること（範囲は各処理が確かめる）。
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

// ---- 画面から来た値を型にそろえる（正しいかは各処理が確かめる） ----

// セッションとスケジュールの ID は randomUUID で作る。'/' などを通すと、Firestore の想定外のパスを指せてしまう
const ID = /^[A-Za-z0-9-]{1,64}$/;

/** セッションやスケジュールの ID。形が正しくなければ InvalidInputError。 */
function readId(value: unknown, what: string): string {
  const id = String(value ?? '');
  if (!ID.test(id)) throw new InvalidInputError(`${what}の指定が正しくありません`);
  return id;
}

const wholeNumber = (value: unknown) => Math.floor(Number(value));

/** セッションとスケジュールで同じ項目。 */
const readCommon = (data: Partial<StartSessionRequest | CreateScheduleRequest>) => ({
  projectId: data.projectId == null ? null : Number(data.projectId),
  tag: String(data.tag ?? '').trim(),
  requiredSec: wholeNumber(data.requiredSec),
  dollars: wholeNumber(data.dollars),
});

// ---- 設定 ----

export const saveSettings = onAuthenticatedCall<SaveSettingsRequest, SaveSettingsResponse>(async (uid, data) => {
  // 空欄のトークンは「変更しない」
  const tokens: Partial<Tokens> = {};
  for (const key of ['togglToken', 'beeminderToken'] as const) {
    const value = String(data[key] ?? '').trim();
    if (value) tokens[key] = value;
  }
  // null は「変更しない」
  const cancelMinutes = data.cancelMinutes == null ? null : wholeNumber(data.cancelMinutes);
  return saveAccountSettings(uid, { tokens, cancelMinutes });
});

// ---- セッションの開始とスケジュールの作成 ----

export const startSession = onAuthenticatedCall<StartSessionRequest, StartSessionResponse>(async (uid, data) => ({
  id: await startNewSession(uid, {
    ...readCommon(data),
    // 数え始める時刻を指定しなければ、開始した時刻から数える
    startAt: data.startAt == null ? null : wholeNumber(data.startAt),
    due: wholeNumber(data.due),
  }),
}));

export const createSchedule = onAuthenticatedCall<CreateScheduleRequest, CreateScheduleResponse>(async (uid, data) => ({
  id: await createNewSchedule(uid, {
    ...readCommon(data),
    repeat: data.repeat as RecurrenceData,
    startMinutes: Number(data.startMinutes),
    dueMinutes: Number(data.dueMinutes),
    timeZone: String(data.timeZone ?? ''),
  }),
}));

// ---- セッションの取り消し ----

export const cancelSession = onAuthenticatedCall<CancelSessionRequest, void>(async (uid, data) => {
  const ref = sessionsRef(uid).doc(readId(data.id, 'セッション'));
  const session = (await ref.get()).data();
  if (!session) throw new InvalidInputError('セッションが見つかりません');
  session.cancel(Date.now());
  // 読んだあとに精算などが書き換えていたら、ConflictError で止まる
  await saveChanges(ref, session);
});

// ---- 手動の更新と精算 ----

export const syncNow = onAuthenticatedCall<void, SyncNowResponse>(async (uid) => {
  const done = await syncSessions(uid);
  return { done: done.map((s) => s.title) };
});

const RESOLUTIONS: readonly ChargeResolution[] = ['charged', 'not_charged'];

/**
 * 締切を過ぎたのに精算できていないセッションを、画面から精算し直す。
 * 課金されたか分からないものは resolve で人の判断を受け取る。
 */
export const settleNow = onAuthenticatedCall<SettleNowRequest, SettleResult>(async (uid, data) => {
  const id = readId(data.id, 'セッション');
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
