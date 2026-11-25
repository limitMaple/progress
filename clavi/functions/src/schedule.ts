// スケジュール（「毎週 月水金 9:00〜18:00 に 2 時間やる」のような繰り返しの約束）の振る舞い。
// 保存する形は model.ts の ScheduleData。Web アプリからも import するので、Node に依存しないこと。
//
// どの日が回の日かは Recurrence（recurrence.ts）が決め、ここはその日の時刻・締切・取り消せる期限を決める。
// 各回のセッションは、取り消せる期限の CREATE_AHEAD 前に作っておく（作るのは generate.ts）。
// 休みたい回は、そのセッションを期限までに取り消す。作ったあとのセッションは手で始めたものと同じ。
//
// 日付は "YYYY-MM-DD"、時刻はその日の 0:00 からの分。どちらもスケジュールの timeZone で読む。

import { formatDuration } from './progress.ts';
import { isMinuteOfDay, isTimeZone, minuteOfDayLabel, Temporal, zonedDate, zonedTime } from './calendar.ts';
import { cancelDeadline, cancelLabel, isCancelMinutes } from './cancel.ts';
import { InvalidInputError } from './errors.ts';
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

/** 新しいスケジュールに要るもの（作る側が決める項目）。 */
export type NewSchedule = Pick<
  ScheduleData, 'id' | 'tag' | 'requiredSec' | 'dollars' | 'repeat' | 'startMinutes' | 'dueMinutes' | 'cancelMinutes' | 'timeZone'
> & { now: number; project: TogglProject | null };

/** 「まだセッションを作っていない最初の回」を表す項目。 */
type NextFields = Pick<ScheduleData, 'nextDate' | 'nextCreateAt'>;

/** 締切の時刻が開始の時刻以前なら、翌日の締切とする。開始から締切までの分。 */
export function windowMinutes({ startMinutes, dueMinutes }: Pick<ScheduleData, 'startMinutes' | 'dueMinutes'>): number {
  return dueMinutes > startMinutes ? dueMinutes - startMinutes : dueMinutes + DAY_MIN - startMinutes;
}

/** 回の中身が正しくなければ InvalidInputError を投げる。Recurrence にした repeat を返す。 */
function validate(data: Omit<NewSchedule, 'id' | 'now' | 'project'>): Recurrence {
  const { requiredSec, dollars, repeat, startMinutes, dueMinutes, cancelMinutes, timeZone } = data;
  // 曜日や日付の確かめ方は、繰り返しの各クラスに任せる
  const recurrence = recurrenceFrom(repeat);
  if (!isMinuteOfDay(startMinutes)) throw new InvalidInputError('カウント開始の時刻を入力してください');
  if (!isMinuteOfDay(dueMinutes)) throw new InvalidInputError('締切の時刻を入力してください');
  if (!isTimeZone(timeZone)) throw new InvalidInputError('タイムゾーンが正しくありません');
  if (!(requiredSec > 0)) throw new InvalidInputError('作業時間を入力してください');
  if (!(dollars >= 1)) throw new InvalidInputError('金額は$1以上にしてください');
  if (!isCancelMinutes(cancelMinutes)) {
    throw new InvalidInputError('設定の取り消し猶予が正しくありません。設定を保存し直してください');
  }
  const window = windowMinutes({ startMinutes, dueMinutes }) * 60;
  if (window < requiredSec) throw new InvalidInputError(`カウント開始から締切まで${formatDuration(window)}しかありません`);
  return recurrence;
}

export class Schedule extends recordClass<ScheduleData>() {
  // repeat から作ったもの。Firestore に保存しないよう # にする
  #recurrence: Recurrence | null = null;

  /**
   * 新しいスケジュール。中身が正しくなければ InvalidInputError を投げる（Functions と入力欄が同じものを使う）。
   * 最初の回は、now の時点でまだ取り消せるもの（作ってすぐ逃げられない回にはしない）。
   */
  static create({ id, now, project, ...fields }: NewSchedule): Schedule {
    const recurrence = validate(fields);
    const schedule = new Schedule({
      id,
      projectId: project?.id ?? null,
      projectName: project?.name ?? '',
      ...fields,
      // 画面から来た値を、繰り返しの種類に要る項目だけにする
      repeat: recurrence.toData(),
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
    if (!first) throw new InvalidInputError('この繰り返しでは、回が1つもありません');
    Object.assign(schedule, schedule.nextFieldsFor(first));
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
      cancelableUntil: cancelDeadline(startAt, this.cancelMinutes),
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
  creationTime(occurrence: Occurrence): number {
    return occurrence.cancelableUntil - CREATE_AHEAD;
  }

  /** その回のセッションをもう作ったか（作らずに過ぎた回も含む）。nextDate より前の回は済んでいる。 */
  isCreated(occurrence: Occurrence): boolean {
    return this.nextDate == null || occurrence.date < this.nextDate;
  }

  /** occurrence を「まだセッションを作っていない最初の回」にするときに保存する項目。null なら回がもう無い。 */
  nextFieldsFor(occurrence: Occurrence | null): NextFields {
    return {
      nextDate: occurrence?.date ?? null,
      nextCreateAt: occurrence ? this.creationTime(occurrence) : null,
    };
  }

  /**
   * now の時点で、セッションを作る時刻を迎えた回を集める（generate.ts が使う）。
   *   ready … セッションを作る回（締切を過ぎてしまった回は除く）
   *   next  … まだセッションを作る時刻になっていない最初の回。回がもう無ければ null
   * 定期実行が止まっていて何回分かたまっていても、締切前のものはすべて作る（取り消せる期限は過ぎているかもしれない）。
   */
  readyOccurrences(now: number): { ready: Occurrence[]; next: Occurrence | null } {
    const ready: Occurrence[] = [];
    if (!this.nextDate) return { ready, next: null };
    for (const o of this.occurrences(this.nextDate)) {
      if (this.creationTime(o) > now) return { ready, next: o };
      if (o.due > now) ready.push(o);
    }
    return { ready, next: null };
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
    return `${minuteOfDayLabel(this.startMinutes)}〜${next}${minuteOfDayLabel(this.dueMinutes)}`;
  }

  /** 「毎週 月水金 9:00〜18:00 に 2時間00分」の形。 */
  get summary(): string {
    return `${this.recurrence.label} ${this.timeRangeLabel} に ${formatDuration(this.requiredSec)}`;
  }

  /** 「カウント開始の1時間00分前まで取り消せます」の形。 */
  get cancelLabel(): string {
    return cancelLabel(this.cancelMinutes);
  }
}
