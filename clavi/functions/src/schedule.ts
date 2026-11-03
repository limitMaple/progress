// スケジュール（「毎週 月水金 9:00〜18:00 に 2 時間やる」のような繰り返しの約束）の振る舞い。
// 保存する形は model.ts の ScheduleData。Web アプリからも import するので、Node に依存しないこと。
//
// どの日が回の日かは Recurrence（recurrence.ts）が決め、ここはその日の時刻・締切・取り消せる期限を決める。
// 各回のセッションは、取り消せる期限の CREATE_AHEAD 前に作っておく（作るのは generate.ts）。
// 休みたい回は、そのセッションを期限までに取り消す。作ったあとのセッションは手で始めたものと同じ。
//
// 日付は "YYYY-MM-DD"、時刻はその日の 0:00 からの分。どちらもスケジュールの timeZone で読む。

import { formatDuration } from './progress.ts';
import { Temporal, zonedDate, zonedTime } from './calendar.ts';
import { recordClass } from './record.ts';
import { recurrenceFrom, type Recurrence } from './recurrence.ts';
import { Session } from './session.ts';
import type { ScheduleData, TogglProject } from './model.ts';

const DAY_MIN = 24 * 60;
const MIN = 60 * 1000;
// 取り消せる期限のこれだけ前に、その回のセッションを作る（取り消すかを考える間をとる）
export const CREATE_AHEAD = 24 * 60 * MIN;

/** スケジュールの 1 回分。 */
export interface Occurrence {
  /** カウント開始の日付（スケジュールの timeZone での "YYYY-MM-DD"） */
  date: string;
  startAt: number;
  due: number;
  /** この時刻より前なら、その回のセッションを取り消せる */
  cancelableUntil: number;
}

/** 締切の時刻が開始の時刻以前なら、翌日の締切とする。開始から締切までの分。 */
export function windowMinutes({ startMinutes, dueMinutes }: Pick<ScheduleData, 'startMinutes' | 'dueMinutes'>): number {
  return dueMinutes > startMinutes ? dueMinutes - startMinutes : dueMinutes + DAY_MIN - startMinutes;
}

export class Schedule extends recordClass<ScheduleData>() {
  // repeat から作ったもの。Firestore に保存しないよう # にする
  #recurrence: Recurrence | null = null;

  /** 新しいスケジュール。最初の回は、now の時点でまだ取り消せるもの（作ってすぐ逃げられない回にはしない）。 */
  static create({ id, now, project, ...rest }: Omit<
    ScheduleData, 'projectId' | 'projectName' | 'createdAt' | 'nextDate' | 'nextCreateAt' | 'message'
  > & { now: number; project: TogglProject | null }): Schedule {
    const schedule = new Schedule({
      id,
      projectId: project?.id ?? null,
      projectName: project?.name ?? '',
      ...rest,
      createdAt: now,
      nextDate: null,
      nextCreateAt: null,
      message: '',
    });
    let first: Occurrence | null = null;
    for (const o of schedule.occurrences(zonedDate(now, schedule.timeZone))) {
      if (o.cancelableUntil > now) {
        first = o;
        break;
      }
    }
    Object.assign(schedule, schedule.positionAt(first));
    return schedule;
  }

  /** どの日が回の日か。 */
  get recurrence(): Recurrence {
    this.#recurrence ??= recurrenceFrom(this.repeat);
    return this.#recurrence;
  }

  /** 回の日付 date の、時刻と締切。date が回の日かは確かめない。 */
  occurrenceAt(date: string): Occurrence {
    const startAt = zonedTime(date, this.startMinutes, this.timeZone);
    // 夏時間の切り替わりの日でも締切がずれないよう、締切の日付と時刻から求める
    const dueDate = this.dueMinutes > this.startMinutes ? date : Temporal.PlainDate.from(date).add({ days: 1 }).toString();
    return {
      date,
      startAt,
      due: zonedTime(dueDate, this.dueMinutes, this.timeZone),
      cancelableUntil: startAt - this.cancelMinutes * MIN,
    };
  }

  /** date 以降の回を早い順に。回がもう無ければそこで終わる（終わらないことが多いので、呼ぶ側で止めること）。 */
  *occurrences(date: string): Generator<Occurrence> {
    const { recurrence } = this;
    for (let d = recurrence.firstOnOrAfter(Temporal.PlainDate.from(date)); d; d = recurrence.firstOnOrAfter(d.add({ days: 1 }))) {
      yield this.occurrenceAt(d.toString());
    }
  }

  /** after より後にカウント開始する回を、早い順に count 件まで。 */
  upcoming(after: number, count: number): Occurrence[] {
    const result: Occurrence[] = [];
    // after の前日から見る（タイムゾーンの日付の境目をまたいでも取りこぼさない）
    const dayBefore = Temporal.PlainDate.from(zonedDate(after, this.timeZone)).subtract({ days: 1 });
    for (const o of this.occurrences(dayBefore.toString())) {
      if (result.length >= count) break;
      if (o.startAt > after) result.push(o);
    }
    return result;
  }

  /** その回のセッションを作る時刻。 */
  createAt(occurrence: Occurrence): number {
    return occurrence.cancelableUntil - CREATE_AHEAD;
  }

  /** occurrence を「まだセッションを作っていない最初の回」とするときの項目。 */
  positionAt(occurrence: Occurrence | null): Pick<ScheduleData, 'nextDate' | 'nextCreateAt'> {
    return {
      nextDate: occurrence?.date ?? null,
      nextCreateAt: occurrence ? this.createAt(occurrence) : null,
    };
  }

  /**
   * now の時点で、セッションを作る時刻を迎えた回を片付ける（generate.ts が使う）。
   *   create … セッションを作る回（締切を過ぎてしまった回は除く）
   *   next   … まだセッションを作る時刻になっていない最初の回
   * 定期実行が止まっていて何回分かたまっていても、締切前のものはすべて作る（取り消せる期限は過ぎているかもしれない）。
   */
  planCreates(now: number): { create: Occurrence[]; next: Occurrence | null } {
    const create: Occurrence[] = [];
    if (!this.nextDate) return { create, next: null };
    for (const o of this.occurrences(this.nextDate)) {
      if (this.createAt(o) > now) return { create, next: o };
      if (o.due > now) create.push(o);
    }
    return { create, next: null };
  }

  /** その回のセッション。ID は回ごとに決まるので、同じ回を 2 回作らない。 */
  sessionFor(occurrence: Occurrence, now: number): Session {
    return Session.start({
      id: `${this.id}-${occurrence.date.replaceAll('-', '')}`,
      now,
      project: this.projectId == null ? null : { id: this.projectId, name: this.projectName },
      tag: this.tag,
      requiredSec: this.requiredSec,
      startAt: occurrence.startAt,
      due: occurrence.due,
      dollars: this.dollars,
      scheduleId: this.id,
      cancelableUntil: occurrence.cancelableUntil,
    });
  }

  // ---- 表示用 ----

  /** 「9:00〜18:00」「22:00〜翌1:00」の形。 */
  get timeRangeLabel(): string {
    const next = this.dueMinutes <= this.startMinutes ? '翌' : '';
    return `${clock(this.startMinutes)}〜${next}${clock(this.dueMinutes)}`;
  }

  /** 「毎週 月水金 9:00〜18:00 に 2時間00分」の形。 */
  get summary(): string {
    return `${this.recurrence.label} ${this.timeRangeLabel} に ${formatDuration(this.requiredSec)}`;
  }

  /** 「開始の1時間00分前まで取り消せます」の形。 */
  get cancelLabel(): string {
    return cancelLabel(this.cancelMinutes);
  }
}

/** 「開始の1時間00分前まで取り消せます」の形。 */
export function cancelLabel(cancelMinutes: number): string {
  return cancelMinutes > 0
    ? `カウント開始の${formatDuration(cancelMinutes * 60)}前まで取り消せます`
    : 'カウント開始まで取り消せます';
}

/** "HH:MM" をその日の 0:00 からの分にする。形が正しくなければ null。 */
export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [h, m] = [Number(match[1]), Number(match[2])];
  return h < 24 && m < 60 ? h * 60 + m : null;
}

/** 分を "9:05" の形にする。 */
export function clock(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
