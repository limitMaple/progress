"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { createSchedule } from "@/lib/firebase";
import { formatDuration, sessionTitle } from "@/functions/src/progress";
import { dateLabel } from "@/functions/src/calendar";
import { recurrenceFrom } from "@/functions/src/recurrence";
import { parseClock, Schedule, windowMinutes } from "@/functions/src/schedule";
import type { RecurrenceData, TogglProject } from "@/functions/src/model";
import { targetLabel, type Message } from "@/components/session/common";
import RecurrenceFields, { RECURRENCE_EDITORS } from "@/components/session/RecurrenceFields";

type FormValues = {
    projectId: string;
    tag: string;
    /** 繰り返しのきまり。入力欄は RecurrenceFields */
    repeat: RecurrenceData;
    startTime: string;
    deadlineTime: string;
    cancelMinutes: string;
    hours: string;
    minutes: string;
    dollars: string;
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
        repeat: RECURRENCE_EDITORS.weekly.initial({ from: localDate(Date.now()), interval: 1 }),
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

    const change = (key: Exclude<keyof FormValues, "repeat">) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { value } = e.target;
        setValues((v) => ({ ...v, [key]: value }));
    };

    const form = readForm();

    function readForm() {
        const now = Date.now();
        const project = projects.find((p) => String(p.id) === values.projectId) ?? null;
        const requiredSec = (Number(values.hours) || 0) * 3600 + (Number(values.minutes) || 0) * 60;
        const dollars = Math.floor(Number(values.dollars) || 0);
        const startMinutes = parseClock(values.startTime);
        const dueMinutes = parseClock(values.deadlineTime);
        const cancelMinutes = Number(values.cancelMinutes);
        const { repeat } = values;

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
            // 次のスケジュールのために、同じ種類の初めの値に戻す（起点と間隔はそのまま）
            setValues((v) => ({
                ...v,
                repeat: RECURRENCE_EDITORS[v.repeat.kind].initial({ from: v.repeat.from, interval: v.repeat.interval }),
            }));
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
            <h2>新しいスケジュール</h2>
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

                <RecurrenceFields value={values.repeat} onChange={(repeat) => setValues((v) => ({ ...v, repeat }))} />

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
        </section>
    );
}
