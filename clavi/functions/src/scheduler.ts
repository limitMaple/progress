// スケジュールの読み書き。カウント開始を迎えた回のセッションを作ることと、その前に回を休むこと。
// 回の計算は schedule.ts。作ったセッションは手で始めたものと同じで、精算も同じ（settle.ts）。
//
// セッションを作るのも休むのもトランザクションの中で行う。カウント開始の直前に「休む」を押して、
// 同時に定期実行がセッションを作っても、どちらか一方だけが通る（休んだのに作られることはない）。

import { getFirestore } from 'firebase-admin/firestore';
import { loadAccount, schedulesRef, sessionsRef } from './store.ts';
import { Session } from './session.ts';
import { dateLabel, nextOccurrence, occurrenceOn, planStarts, scheduledSessionId } from './schedule.ts';
import type { ScheduleData, TogglProject } from './model.ts';

/** 新しいスケジュール。最初の回は now より後にカウント開始するもの。 */
export function newSchedule({ id, now, project, ...rest }: Omit<
  ScheduleData, 'projectId' | 'projectName' | 'createdAt' | 'nextDate' | 'nextStartAt' | 'skipDates' | 'message'
> & { now: number; project: TogglProject | null }): ScheduleData {
  const schedule: ScheduleData = {
    id,
    projectId: project?.id ?? null,
    projectName: project?.name ?? '',
    ...rest,
    createdAt: now,
    nextDate: null,
    nextStartAt: null,
    skipDates: [],
    message: '',
  };
  const next = nextOccurrence(schedule, now);
  return { ...schedule, nextDate: next?.date ?? null, nextStartAt: next?.startAt ?? null };
}

/**
 * カウント開始を迎えた回のセッションを作り、次の回へ進める。作ったセッションの ID を返す。
 * Beeminder の設定が無ければ作らない（課金できない約束は始めない。startSession と同じ）。
 */
export async function startScheduledSessions(uid: string, scheduleId: string, now = Date.now()): Promise<string[]> {
  const { settings, tokens } = await loadAccount(uid);
  const canCharge = Boolean(tokens.beeminderToken && settings.beeminderUser);
  const ref = schedulesRef(uid).doc(scheduleId);

  return getFirestore().runTransaction(async (tx) => {
    const schedule = (await tx.get(ref)).data();
    if (!schedule || schedule.nextStartAt == null || schedule.nextStartAt > now) return [];

    const plan = planStarts(schedule, now);
    const refs = plan.start.map((o) => sessionsRef(uid).doc(scheduledSessionId(schedule.id, o.date)));
    const existing = refs.length ? await tx.getAll(...refs) : [];

    const created: string[] = [];
    if (canCharge) {
      plan.start.forEach((occurrence, i) => {
        // ID は回ごとに決まるので、もしあれば作り直さない
        if (existing[i].exists) return;
        const session = Session.start({
          id: refs[i].id,
          now,
          project: schedule.projectId == null ? null : { id: schedule.projectId, name: schedule.projectName },
          tag: schedule.tag,
          requiredSec: schedule.requiredSec,
          startAt: occurrence.startAt,
          due: occurrence.due,
          dollars: schedule.dollars,
          scheduleId: schedule.id,
        });
        tx.set(refs[i], session);
        created.push(session.id);
      });
    }

    const missed = canCharge ? [] : plan.start;
    tx.update(ref, {
      nextDate: plan.next?.date ?? null,
      nextStartAt: plan.next?.startAt ?? null,
      skipDates: plan.skipDates,
      message: missed.length
        ? `${missed.map((o) => dateLabel(o.date)).join('、')}の回は、BeeminderのAPIトークンが未設定なので始めませんでした`
        : created.length ? '' : schedule.message,
    });
    return created;
  });
}

/** その日の回を休む（skip が false なら休みをやめる）。カウント開始を過ぎた回は変えられない。 */
export async function skipOccurrence(
  uid: string,
  scheduleId: string,
  date: string,
  skip: boolean,
  now = Date.now(),
): Promise<void> {
  const ref = schedulesRef(uid).doc(scheduleId);
  await getFirestore().runTransaction(async (tx) => {
    const schedule = (await tx.get(ref)).data();
    if (!schedule) throw new Error('スケジュールが見つかりません');
    const occurrence = occurrenceOn(schedule, date);
    if (!occurrence) throw new Error('その日はスケジュールの曜日ではありません');
    // nextDate より前の回は、もうセッションを作った（か、作らずに過ぎた）
    if (occurrence.startAt <= now || !schedule.nextDate || date < schedule.nextDate) {
      throw new Error(`${dateLabel(date)}の回はカウントが始まっているので、変えられません`);
    }
    const others = schedule.skipDates.filter((d) => d !== date);
    tx.update(ref, { skipDates: skip ? [...others, date].sort() : others });
  });
}
