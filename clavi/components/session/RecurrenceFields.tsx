"use client";

import type { ChangeEvent, ReactNode } from "react";
import { WEEKDAYS } from "@/functions/src/calendar";
import type { RecurrenceData } from "@/functions/src/model";

// 繰り返しのきまりの入力欄。きまりの種類ごとの入力欄を RecurrenceEditor として持ち、
// RecurrenceFields は選ばれた種類のものを出すだけにする（種類による分岐を書かない）。
// 種類は functions/src/recurrence.ts の各クラスと 1 対 1 に対応する。種類を足すときは、
// あちらにクラスを足し、ここに RecurrenceEditor を書いて RECURRENCE_EDITORS に登録する。
// 値が正しいかは recurrence.ts のクラスが確かめるので、ここでは確かめない。

type Kind = RecurrenceData["kind"];
type DataOf<K extends Kind> = Extract<RecurrenceData, { kind: K }>;
type Base = { from: string; interval: number };

type FieldsProps<T> = { value: T; onChange: (value: T) => void };

/** 繰り返しの種類 1 つ分の入力欄。 */
interface RecurrenceEditor<K extends Kind> {
    /** 選択肢の名前（間隔の数のあとに続く） */
    label: string;
    /** この種類に切り替えたときの値。起点と間隔は引き継ぐ */
    initial(base: Base): DataOf<K>;
    /** この種類にだけある入力欄。無ければ null */
    Fields: ((props: FieldsProps<DataOf<K>>) => ReactNode) | null;
}

// 月曜から並べる
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKS = [1, 2, 3, 4, -1];

/** 数の入力欄の値。空欄は NaN にする（0 にすると、消して打ち直せない）。正しいかは recurrence.ts が確かめる。 */
const toNumber = (value: string) => (value === "" ? NaN : Number(value));
const fromNumber = (n: number) => (Number.isNaN(n) ? "" : String(n));

function WeeklyFields({ value, onChange }: FieldsProps<DataOf<"weekly">>) {
    const toggle = (day: number) => onChange({
        ...value,
        weekdays: value.weekdays.includes(day) ? value.weekdays.filter((d) => d !== day) : [...value.weekdays, day],
    });
    return (
        <div className="field">
            <span className="muted">曜日</span>
            <span className="row weekdays">
                {WEEKDAY_ORDER.map((day) => (
                    <label key={day} className={value.weekdays.includes(day) ? "on" : ""}>
                        <input type="checkbox" checked={value.weekdays.includes(day)} onChange={() => toggle(day)} />
                        {WEEKDAYS[day]}
                    </label>
                ))}
            </span>
        </div>
    );
}

function MonthlyByDayFields({ value, onChange }: FieldsProps<DataOf<"monthlyByDay">>) {
    return (
        <label>
            <span>日</span>
            <span className="row">
                毎回
                <input
                    type="number" min="1" max="31" className="num"
                    value={fromNumber(value.day)}
                    onChange={(e) => onChange({ ...value, day: toNumber(e.target.value) })}
                />日（その日が無い月は休み）
            </span>
        </label>
    );
}

function MonthlyByWeekdayFields({ value, onChange }: FieldsProps<DataOf<"monthlyByWeekday">>) {
    return (
        <label>
            <span>曜日</span>
            <span className="row">
                <select value={value.week} onChange={(e) => onChange({ ...value, week: Number(e.target.value) })}>
                    {WEEKS.map((w) => <option key={w} value={w}>{w > 0 ? `第${w}` : "最終"}</option>)}
                </select>
                <select value={value.weekday} onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })}>
                    {WEEKDAY_ORDER.map((d) => <option key={d} value={d}>{WEEKDAYS[d]}曜</option>)}
                </select>
            </span>
        </label>
    );
}

export const RECURRENCE_EDITORS: { [K in Kind]: RecurrenceEditor<K> } = {
    daily: {
        label: "日ごと",
        initial: (base) => ({ kind: "daily", ...base }),
        Fields: null,
    },
    weekly: {
        label: "週ごと",
        initial: (base) => ({ kind: "weekly", ...base, weekdays: [] }),
        Fields: WeeklyFields,
    },
    monthlyByDay: {
        label: "か月ごと（日付）",
        // 起点の日を初めの値にする
        initial: (base) => ({ kind: "monthlyByDay", ...base, day: Number(base.from.slice(8)) || 1 }),
        Fields: MonthlyByDayFields,
    },
    monthlyByWeekday: {
        label: "か月ごと（曜日）",
        initial: (base) => ({ kind: "monthlyByWeekday", ...base, week: 1, weekday: 1 }),
        Fields: MonthlyByWeekdayFields,
    },
};

/** 繰り返しの入力欄（間隔・種類・種類ごとの欄・起点）。 */
export default function RecurrenceFields({ value, onChange }: FieldsProps<RecurrenceData>) {
    // value.kind の editor は value の型に合うが、TypeScript には対応が分からないので広げて扱う
    const { Fields } = RECURRENCE_EDITORS[value.kind] as unknown as RecurrenceEditor<Kind>;
    const base = { from: value.from, interval: value.interval };

    const changeKind = (e: ChangeEvent<HTMLSelectElement>) => {
        onChange(RECURRENCE_EDITORS[e.target.value as Kind].initial(base));
    };

    return (
        <>
            <label>
                <span>繰り返し</span>
                <span className="row">
                    <input
                        type="number" min="1" max="12" className="num"
                        value={fromNumber(value.interval)}
                        onChange={(e) => onChange({ ...value, interval: toNumber(e.target.value) })}
                    />
                    <select value={value.kind} onChange={changeKind}>
                        {(Object.keys(RECURRENCE_EDITORS) as Kind[]).map((kind) => (
                            <option key={kind} value={kind}>{RECURRENCE_EDITORS[kind].label}</option>
                        ))}
                    </select>
                </span>
            </label>

            {Fields && <Fields value={value} onChange={onChange} />}

            <label>
                <span>起点</span>
                <span className="row">
                    <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
                </span>
            </label>
            <p className="field-note muted">この日から数えます（「2週間ごと」などの「ごと」もこの日から）。</p>
        </>
    );
}
