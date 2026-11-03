// 繰り返しのきまり（「2週間ごとの月水金」「毎月第2火曜」など）。どの日が回の日かだけを決める。
// 時刻とタイムゾーンは Schedule（schedule.ts）が扱うので、ここでは日付（Temporal.PlainDate）だけを見る。
// Web アプリからも import するので、Node に依存しないこと。
//
// きまりの種類ごとに、Recurrence を実装したクラスを 1 つ作る。使う側は Recurrence のメソッドしか呼ばないので、
// 種類を足すときはクラスを書いて RECURRENCES に登録するだけでよい。
// Firestore には toData() の形で保存する（JSON しか置けないので、kind で種類を見分ける）。戻すのは recurrenceFrom。

import { isDate, Temporal, weekdayOf, WEEKDAYS } from './calendar.ts';
import type { RecurrenceData } from './model.ts';

type PlainDate = Temporal.PlainDate;
type PlainYearMonth = Temporal.PlainYearMonth;

export interface Recurrence {
  /** date 以降（date を含む）で最初の回の日付。もう回が無ければ null。起点（from）より前の日は回にしない */
  firstOnOrAfter(date: PlainDate): PlainDate | null;
  /** 「2週間ごと 月水金」の形 */
  readonly label: string;
  toData(): RecurrenceData;
}

type DataOf<K extends RecurrenceData['kind']> = Omit<Extract<RecurrenceData, { kind: K }>, 'kind'>;

// 間隔の上限。画面の入力欄と同じ
const MAX_INTERVAL = 12;

/** 起点と間隔を確かめ、起点を PlainDate にする（どのきまりにもある項目）。 */
function parseBase({ from, interval }: { from: string; interval: number }): PlainDate {
  if (!isDate(String(from))) throw new Error('繰り返しの起点の日付が正しくありません');
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
    throw new Error(`間隔は1〜${MAX_INTERVAL}にしてください`);
  }
  return Temporal.PlainDate.from(from);
}

const isWeekday = (n: number) => Number.isInteger(n) && n >= 0 && n <= 6;
/** a と b の遅いほう。 */
const later = (a: PlainDate, b: PlainDate) => (Temporal.PlainDate.compare(a, b) < 0 ? b : a);
/** その日を含む週の月曜。 */
const mondayOf = (date: PlainDate) => date.subtract({ days: date.dayOfWeek - 1 });

/** N 日ごと。 */
export class DailyRecurrence implements Recurrence {
  readonly from: PlainDate;
  readonly interval: number;

  constructor({ from, interval }: DataOf<'daily'>) {
    this.from = parseBase({ from, interval });
    this.interval = interval;
  }

  firstOnOrAfter(date: PlainDate): PlainDate {
    const start = later(date, this.from);
    const rest = this.from.until(start).days % this.interval;
    return rest ? start.add({ days: this.interval - rest }) : start;
  }

  get label(): string {
    return this.interval === 1 ? '毎日' : `${this.interval}日ごと`;
  }

  toData(): RecurrenceData {
    return { kind: 'daily', from: this.from.toString(), interval: this.interval };
  }
}

/** N 週ごとの、決まった曜日。週は月曜から数え、起点の日を含む週を 1 週目とする。 */
export class WeeklyRecurrence implements Recurrence {
  readonly from: PlainDate;
  readonly interval: number;
  /** 0 が日曜。重なりなく昇順 */
  readonly weekdays: readonly number[];

  constructor({ from, interval, weekdays }: DataOf<'weekly'>) {
    this.from = parseBase({ from, interval });
    const days = Array.isArray(weekdays) ? [...new Set(weekdays.map(Number))].sort() : [];
    if (!days.length || !days.every(isWeekday)) throw new Error('曜日を選んでください');
    this.interval = interval;
    this.weekdays = days;
  }

  firstOnOrAfter(date: PlainDate): PlainDate | null {
    const firstWeek = mondayOf(this.from);
    let d = later(date, this.from);
    // 回のある週は interval 週に 1 回なので、interval + 1 週ぶん見れば必ず見つかる
    for (let i = 0; i < 7 * (this.interval + 1); i++, d = d.add({ days: 1 })) {
      const weeks = firstWeek.until(mondayOf(d)).days / 7;
      if (weeks % this.interval === 0 && this.weekdays.includes(weekdayOf(d))) return d;
    }
    return null;
  }

  get label(): string {
    const days = weekdaysLabel(this.weekdays);
    if (this.interval > 1) return `${this.interval}週間ごと ${days}`;
    // 「毎日」「平日」「土日」はそれだけで分かる
    return ['毎日', '平日', '土日'].includes(days) ? days : `毎週 ${days}`;
  }

  toData(): RecurrenceData {
    return { kind: 'weekly', from: this.from.toString(), interval: this.interval, weekdays: [...this.weekdays] };
  }
}

/** N か月ごと。どの日にするかはサブクラスが決める。 */
abstract class MonthlyRecurrence implements Recurrence {
  readonly from: PlainDate;
  readonly interval: number;

  protected constructor(base: { from: string; interval: number }) {
    this.from = parseBase(base);
    this.interval = base.interval;
  }

  /** その月の回の日付。その月に無ければ null（31日のない月など）。 */
  protected abstract dayIn(month: PlainYearMonth): PlainDate | null;

  abstract get label(): string;
  abstract toData(): RecurrenceData;

  firstOnOrAfter(date: PlainDate): PlainDate | null {
    const start = later(date, this.from);
    const firstMonth = this.from.toPlainYearMonth();
    const elapsed = firstMonth.until(start.toPlainYearMonth(), { largestUnit: 'months' }).months;
    let month = firstMonth.add({ months: Math.ceil(elapsed / this.interval) * this.interval });
    // 回のある月の並びは 12 か月で一巡するので、それだけ見て無ければもう無い（2月だけの30日など）
    for (let i = 0; i <= 12; i++, month = month.add({ months: this.interval })) {
      const d = this.dayIn(month);
      if (d && Temporal.PlainDate.compare(d, start) >= 0) return d;
    }
    return null;
  }

  protected get every(): string {
    return this.interval === 1 ? '毎月' : `${this.interval}か月ごと `;
  }
}

/** N か月ごとの、決まった日（その日が無い月は飛ばす）。 */
export class MonthlyByDayRecurrence extends MonthlyRecurrence {
  readonly day: number;

  constructor({ from, interval, day }: DataOf<'monthlyByDay'>) {
    super({ from, interval });
    if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error('日は1〜31にしてください');
    this.day = day;
  }

  protected dayIn(month: PlainYearMonth): PlainDate | null {
    return this.day <= month.daysInMonth ? month.toPlainDate({ day: this.day }) : null;
  }

  get label(): string {
    return `${this.every}${this.day}日`;
  }

  toData(): RecurrenceData {
    return { kind: 'monthlyByDay', from: this.from.toString(), interval: this.interval, day: this.day };
  }
}

/** N か月ごとの、第 N の決まった曜日（week が -1 なら最後の）。 */
export class MonthlyByWeekdayRecurrence extends MonthlyRecurrence {
  /** 1〜4、または最後を表す -1 */
  readonly week: number;
  /** 0 が日曜 */
  readonly weekday: number;

  constructor({ from, interval, week, weekday }: DataOf<'monthlyByWeekday'>) {
    super({ from, interval });
    if (![1, 2, 3, 4, -1].includes(week)) throw new Error('第何週かを選んでください');
    if (!isWeekday(weekday)) throw new Error('曜日を選んでください');
    this.week = week;
    this.weekday = weekday;
  }

  protected dayIn(month: PlainYearMonth): PlainDate {
    if (this.week > 0) {
      const first = month.toPlainDate({ day: 1 });
      return first.add({ days: (this.weekday - weekdayOf(first) + 7) % 7 + (this.week - 1) * 7 });
    }
    const last = month.toPlainDate({ day: month.daysInMonth });
    return last.subtract({ days: (weekdayOf(last) - this.weekday + 7) % 7 });
  }

  get label(): string {
    return `${this.every}${this.week > 0 ? `第${this.week}` : '最終'}${WEEKDAYS[this.weekday]}曜`;
  }

  toData(): RecurrenceData {
    return {
      kind: 'monthlyByWeekday', from: this.from.toString(), interval: this.interval, week: this.week, weekday: this.weekday,
    };
  }
}

// 保存した形からクラスを作る。種類を足したらここに登録する
const RECURRENCES: { [K in RecurrenceData['kind']]: new (data: DataOf<K>) => Recurrence } = {
  daily: DailyRecurrence,
  weekly: WeeklyRecurrence,
  monthlyByDay: MonthlyByDayRecurrence,
  monthlyByWeekday: MonthlyByWeekdayRecurrence,
};

/** 保存した形（か画面から来た値）を Recurrence にする。値が正しくなければ例外を投げる。 */
export function recurrenceFrom(data: RecurrenceData): Recurrence {
  const kind = data?.kind;
  if (!Object.hasOwn(RECURRENCES, kind)) throw new Error('繰り返しの種類が正しくありません');
  const Recurrence = RECURRENCES[kind] as new (data: RecurrenceData) => Recurrence;
  return new Recurrence(data);
}

/** 「毎日」「平日」「土日」「月水金」の形。 */
export function weekdaysLabel(weekdays: readonly number[]): string {
  const days = [...new Set(weekdays)].sort();
  if (days.length === 7) return '毎日';
  if (days.join() === '1,2,3,4,5') return '平日';
  if (days.join() === '0,6') return '土日';
  // 月曜から並べる
  return [...days.filter((d) => d > 0), ...days.filter((d) => d === 0)].map((d) => WEEKDAYS[d]).join('');
}
