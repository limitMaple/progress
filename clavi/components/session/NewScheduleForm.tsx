"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { createSchedule } from "@/lib/firebase";
import { formatDuration, sessionTitle } from "@/functions/src/progress";
import { dateLabel, WEEKDAYS } from "@/functions/src/calendar";
import { recurrenceFrom } from "@/functions/src/recurrence";
import { parseClock, Schedule, windowMinutes } from "@/functions/src/schedule";
import type { RecurrenceData, TogglProject } from "@/functions/src/model";
import { targetLabel, type Message } from "@/components/session/common";

// 月曜から並べる
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKS = [1, 2, 3, 4, -1];

type Kind = RecurrenceData["kind"];

type FormValues = {
    projectId: string;
    tag: string;
    kind: Kind;
    /** 何日・週・か月ごとか */
    interval: string;
    /** 繰り返しの起点の日付 "YYYY-MM-DD"。これより前は回にしない */
    from: string;
    /** 毎週のときの曜日 */
    weekdays: number[];
    /** 毎月（日付）のときの日 */
    day: string;
    /** 毎月（曜日）のときの第何週（最後は -1）と曜日 */
    week: string;
    weekday: string;
    startTime: string;
    deadlineTime: string;
    cancelMinutes: string;
    hours: string;
    minutes: string;
    dollars: string;
};

type Base = { from: string; interval: number };

/** 繰り返しの種類ごとの、選択肢の名前と、入力欄の値から保存する形を作る方法。 */
const KINDS: { [K in Kind]: { label: string; build: (v: FormValues, base: Base) => RecurrenceData } } = {
    daily: { label: "日ごと", build: (_, base) => ({ kind: "daily", ...base }) },
    weekly: { label: "週ごと", build: (v, base) => ({ kind: "weekly", ...base, weekdays: [...v.weekdays] }) },
    monthlyByDay: {
        label: "か月ごと（日付）",
        build: (v, base) => ({ kind: "monthlyByDay", ...base, day: Number(v.day) }),
    },
    monthlyByWeekday: {
        label: "か月ごと（曜日）",
        build: (v, base) => ({ kind: "monthlyByWeekday", ...base, week: Number(v.week), weekday: Number(v.weekday) }),
    },
};

/** 時刻 ms の、この画面のタイムゾーンでの日付 "YYYY-MM-DD"。 */
function localDate(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function initialValues(requiredSec: number): FormValues {
    return {
        projectId: "",
        tag: "",
        kind: "weekly",
        interval: "1",
        from: localDate(Date.now()),
        weekdays: [],
        day: "1",
        week: "1",
        weekday: "1",
        startTime: "",
        deadlineTime: "",
        cancelMinutes: "60",
        hours: String(Math.floor(requiredSec / 3600)),
        minutes: String(Math.floor((requiredSec % 3600) / 60)),
        dollars: "0",
    };
}

/**
 * 新しいスケジュールの入力欄。各回のセッションは、取り消せる期限の 1 日前に作られる。
 * 引数の扱いは NewSessionForm と同じ。
 */
export default function NewScheduleForm({ initialRequiredSec, projects, tags, disabled, setBusy, setMessage }: {
    initialRequiredSec: number;
    projects: TogglProject[];
    tags: string[];
    disabled: boolean;
    setBusy: (busy: boolean) => void;
    setMessage: (message: Message) => void;
}) {
    const [values, setValues] = useState(() => initialValues(initialRequiredSec));

    const change = (key: Exclude<keyof FormValues, "weekdays">) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { value } = e.target;
        setValues((v) => ({ ...v, [key]: value }));
    };
    const toggleWeekday = (day: number) => setValues((v) => ({
        ...v,
        weekdays: v.weekdays.includes(day) ? v.weekdays.filter((d) => d !== day) : [...v.weekdays, day],
    }));

    const form = readForm();

    function readForm() {
        const now = Date.now();
        const project = projects.find((p) => String(p.id) === values.projectId) ?? null;
        const requiredSec = (Number(values.hours) || 0) * 3600 + (Number(values.minutes) || 0) * 60;
        const dollars = Math.floor(Number(values.dollars) || 0);
        const startMinutes = parseClock(values.startTime);
        const dueMinutes = parseClock(values.deadlineTime);
        const cancelMinutes = Number(values.cancelMinutes);
        const repeat = KINDS[values.kind].build(values, { from: values.from, interval: Number(values.interval) });

        function validate(): string {
            try {
                // 曜日や日付の確かめ方は、繰り返しの各クラスに任せる
                recurrenceFrom(repeat);
            } catch (err) {
                return (err as Error).message;
            }
            if (startMinutes == null) return "カウント開始の時刻を入力してください";
            if (dueMinutes == null) return "締切の時刻を入力してください";
            if (values.cancelMinutes.trim() === "" || !(Number.isInteger(cancelMinutes) && cancelMinutes >= 0)) {
                return "取り消せる期限を、0以上の分で入力してください";
            }
            if (requiredSec <= 0) return "作業時間を入力してください";
            if (dollars < 1) return "金額は$1以上にしてください";
            const window = windowMinutes({ startMinutes, dueMinutes }) * 60;
            if (window < requiredSec) return `カウント開始から締切まで${formatDuration(window)}しかありません`;
            return "";
        }
        const error = validate();
        if (error) return { error, request: null, schedule: null };

        const fields = {
            tag: values.tag.trim(),
            requiredSec,
            dollars,
            repeat,
            startMinutes: startMinutes!,
            dueMinutes: dueMinutes!,
            cancelMinutes,
            // 時刻はこの画面のタイムゾーンで読む
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
        const request = { projectId: project?.id ?? null, ...fields };
        // 作ったらどうなるかを見せるため、保存はせずに Functions と同じ計算をする
        const schedule = Schedule.create({ id: "preview", now, project, ...fields });
        if (!schedule.nextDate) return { error: "この繰り返しでは、回が1つもありません", request: null, schedule: null };
        return { error: "", request, schedule };
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        const { error, request, schedule } = readForm();
        if (disabled || error || !request || !schedule) return;
        if (!confirm(
            `${sessionTitle(schedule)}\n`
            + `${schedule.summary}、${targetLabel(schedule)}を数えます。\n`
            + `届かなければ毎回 $${request.dollars} が課金されます。\n`
            + `最初の回は ${dateLabel(schedule.nextDate!)} です。\n\n`
            + `各回のセッションは、取り消せる期限の1日前に作られます。${schedule.cancelLabel}。\n`
            + "このスケジュールを作りますか？",
        )) return;

        setBusy(true);
        setMessage({ text: "", kind: "" });
        try {
            await createSchedule(request);
            setValues((v) => ({ ...v, weekdays: [] }));
            setMessage({ text: "スケジュールを作りました。各回のセッションは、取り消せる期限の1日前に作られます。", kind: "ok" });
        } catch (err) {
            setMessage({ text: (err as Error).message, kind: "error" });
        } finally {
            setBusy(false);
        }
    }

    const hint = form.error
        || `${form.schedule!.summary}（${targetLabel(form.schedule!)}）。`
            + `最初の回は ${dateLabel(form.schedule!.nextDate!)}。${form.schedule!.cancelLabel}`;

    return (
        <section>
            <details className="schedule-form-wrap">
                <summary><h2>新しいスケジュール</h2></summary>
                <form className="session-form" onSubmit={submit} noValidate>
                    <label>
                        <span>プロジェクト</span>
                        <select value={values.projectId} onChange={change("projectId")}>
                            <option value="">指定なし</option>
                            {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                        </select>
                    </label>

                    <label>
                        <span>タグ</span>
                        <input
                            list="schedule-tag-options"
                            placeholder="空欄ならタグで絞らない"
                            autoComplete="off"
                            value={values.tag}
                            onChange={change("tag")}
                        />
                    </label>
                    <datalist id="schedule-tag-options">
                        {tags.map((name) => <option key={name} value={name} />)}
                    </datalist>

                    <label>
                        <span>繰り返し</span>
                        <span className="row">
                            <input
                                type="number" min="1" max="12" className="num"
                                value={values.interval} onChange={change("interval")}
                            />
                            <select value={values.kind} onChange={change("kind")}>
                                {(Object.keys(KINDS) as Kind[]).map((kind) => (
                                    <option key={kind} value={kind}>{KINDS[kind].label}</option>
                                ))}
                            </select>
                        </span>
                    </label>

                    {values.kind === "weekly" && (
                        <div className="field">
                            <span className="muted">曜日</span>
                            <span className="row weekdays">
                                {WEEKDAY_ORDER.map((day) => (
                                    <label key={day} className={values.weekdays.includes(day) ? "on" : ""}>
                                        <input
                                            type="checkbox"
                                            checked={values.weekdays.includes(day)}
                                            onChange={() => toggleWeekday(day)}
                                        />
                                        {WEEKDAYS[day]}
                                    </label>
                                ))}
                            </span>
                        </div>
                    )}

                    {values.kind === "monthlyByDay" && (
                        <label>
                            <span>日</span>
                            <span className="row">
                                毎回
                                <input
                                    type="number" min="1" max="31" className="num"
                                    value={values.day} onChange={change("day")}
                                />日（その日が無い月は休み）
                            </span>
                        </label>
                    )}

                    {values.kind === "monthlyByWeekday" && (
                        <label>
                            <span>曜日</span>
                            <span className="row">
                                <select value={values.week} onChange={change("week")}>
                                    {WEEKS.map((w) => <option key={w} value={String(w)}>{w > 0 ? `第${w}` : "最終"}</option>)}
                                </select>
                                <select value={values.weekday} onChange={change("weekday")}>
                                    {WEEKDAY_ORDER.map((d) => <option key={d} value={String(d)}>{WEEKDAYS[d]}曜</option>)}
                                </select>
                            </span>
                        </label>
                    )}

                    <label>
                        <span>起点</span>
                        <span className="row">
                            <input type="date" value={values.from} onChange={change("from")} />
                        </span>
                    </label>
                    <p className="field-note muted">この日から数えます（「2週間ごと」などの「ごと」もこの日から）。</p>

                    <label>
                        <span>カウント開始</span>
                        <span className="row">
                            <input type="time" value={values.startTime} onChange={change("startTime")} />
                        </span>
                    </label>

                    <label>
                        <span>締切</span>
                        <span className="row">
                            <input type="time" value={values.deadlineTime} onChange={change("deadlineTime")} />
                        </span>
                    </label>
                    <p className="field-note muted">締切がカウント開始より前の時刻なら、翌日の締切になります。</p>

                    <label>
                        <span>取り消し</span>
                        <span className="row">
                            カウント開始の
                            <input
                                type="number" min="0" step="5" className="num"
                                value={values.cancelMinutes} onChange={change("cancelMinutes")}
                            />分前まで
                        </span>
                    </label>
                    <p className="field-note muted">休みたい回は、この期限までにそのセッションを取り消します。</p>

                    <label>
                        <span>作業時間</span>
                        <span className="row">
                            <input
                                type="number" min="0" max="23" className="num"
                                value={values.hours} onChange={change("hours")}
                            />時間
                            <input
                                type="number" min="0" max="59" step="5" className="num"
                                value={values.minutes} onChange={change("minutes")}
                            />分
                        </span>
                    </label>

                    <label>
                        <span>金額</span>
                        <span className="row">
                            $<input
                                type="number" min="1" step="1" className="num"
                                value={values.dollars} onChange={change("dollars")}
                            />
                        </span>
                    </label>

                    <p className={`hint ${form.error ? "error" : ""}`}>{hint}</p>
                    <button type="submit" className="primary" disabled={disabled || Boolean(form.error)}>
                        スケジュールを作る
                    </button>
                </form>
            </details>
        </section>
    );
}
