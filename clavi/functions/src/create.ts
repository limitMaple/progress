// セッションを始める・スケジュールを作る（どちらも「締切までにやる」という約束を新しく作る）。
// 中身が正しいかは Session（validateStartSessionInput）と Schedule.create が確かめる。ここは
// アカウントで作れるかの確認と保存だけを持つ。

import { randomUUID } from 'node:crypto';
import { cancelableUntilFor } from './cancel.ts';
import { InvalidInputError } from './errors.ts';
import { Schedule, type CreateScheduleInput } from './schedule.ts';
import { Session, validateStartSessionInput } from './session.ts';
import { canCharge, loadAccount, schedulesRef, sessionsRef, userRef } from './store.ts';
import type { StartSessionRequest } from './requests.ts';

/**
 * 約束を作れるアカウントか確かめ、設定と、数えるプロジェクトを返す。
 * 課金できない約束は作らない。プロジェクトは設定に控えた（Toggl で進行中の）ものだけ選べる。
 */
async function resolveAccountAndProject(uid: string, projectId: number | null) {
  const account = await loadAccount(uid);
  if (!canCharge(account)) throw new InvalidInputError('BeeminderのAPIトークンが未設定です');
  const { settings } = account;
  const project = projectId == null ? null : settings.projects.find((p) => p.id === projectId);
  if (project === undefined) {
    throw new InvalidInputError('そのプロジェクトは選べません。設定を保存し直して、プロジェクトの一覧を取り直してください');
  }
  return { settings, project };
}

/** セッションを始める。作ったセッションの ID を返す。 */
export async function startSession(uid: string, request: StartSessionRequest, now = Date.now()): Promise<string> {
  const { projectId, tag, requiredSec, startAt, due, dollars } = request;
  validateStartSessionInput(request, now);

  const { settings, project } = await resolveAccountAndProject(uid, projectId);
  const session = Session.start({
    // 数え始める時刻を指定しなければ、開始した時刻から数える
    id: randomUUID(), now, project, tag, requiredSec, startAt: startAt ?? now, due, dollars,
    cancelableUntil: cancelableUntilFor(startAt, settings.cancelMinutes, now),
  });
  await sessionsRef(uid).doc(session.id).set(session);
  // 次の入力欄の初期値にする
  await userRef(uid).set({ lastRequiredSec: requiredSec }, { merge: true });
  return session.id;
}

/** スケジュールの中身のうち、作る人が決めるもの（ID・時刻・取り消し猶予はここで決める）。 */
export type ScheduleRequest = Omit<CreateScheduleInput, 'id' | 'now' | 'project' | 'cancelMinutes'> & {
  projectId: number | null;
};

/**
 * スケジュールを作る。作ったスケジュールの ID を返す。
 * 取り消し猶予は設定のものを控える（スケジュールごとには決めない。控えるので、あとで設定が変わっても影響しない）。
 */
export async function createSchedule(uid: string, request: ScheduleRequest, now = Date.now()): Promise<string> {
  const { projectId, ...fields } = request;
  const { settings, project } = await resolveAccountAndProject(uid, projectId);
  const schedule = Schedule.create({ ...fields, id: randomUUID(), now, project, cancelMinutes: settings.cancelMinutes });
  await schedulesRef(uid).doc(schedule.id).set(schedule);
  return schedule.id;
}
