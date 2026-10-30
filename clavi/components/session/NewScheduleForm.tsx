"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { createSchedule } from "@/lib/firebase";
import { formatDuration, sessionTitle } from "@/functions/src/progress";
import { dateLabel, parseClock, scheduleSummary, upcoming, windowMinutes } from "@/functions/src/schedule";
import type { TogglProject } from "@/functions/src/model";
import { targetLabel, type Message } from "@/components/session/common";

const WEEKDAYS = "日月火水木金土";
// 月曜から並べる
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

type FormValues = {
    projectId: string;
    tag: string;
    weekdays: number[];
    startTime: string;
    deadlineTime: string;
    hours: string;
    minutes: string;
    dollars: string;
};

function initialValues(requiredSec: number): FormValues {
    return {
        projectId: "",
        tag: "",
        weekdays: [],
        startTime: "",
        deadlineTime: "",
        hours: String(Math.floor(requiredSec / 3600)),
        minutes: String(Math.floor((requiredSec % 3600) / 60)),
        dollars: "0",
    };
}

/**
 * 新しいスケジュールの入力欄。選んだ曜日のカウント開始の時刻に、毎回セッションが始まる。
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
        const project = projects.find((p) => String(p.id) === values.projectId) ?? null;
        const requiredSec = (Number(values.hours) || 0) * 3600 + (Number(values.minutes) || 0) * 60;
        const dollars = Math.floor(Number(values.dollars) || 0);
        const startMinutes = parseClock(values.startTime);
        const dueMinutes = parseClock(values.deadlineTime);

        let error = "";
        if (!values.weekdays.length) error = "曜日を選んでください";
        else if (startMinutes == null) error = "カウント開始の時刻を入力してください";
        else if (dueMinutes == null) error = "締切の時刻を入力してください";
        else if (requiredSec <= 0) error = "作業時間を入力してください";
        else if (dollars < 1) error = "金額は$1以上にしてください";
        else if (windowMinutes({ startMinutes, dueMinutes }) * 60 < requiredSec) {
            error = `カウント開始から締切まで${formatDuration(windowMinutes({ startMinutes, dueMinutes }) * 60)}しかありません`;
        }
        return {
            projectId: project?.id ?? null,
            projectName: project?.name ?? "",
            tag: values.tag.trim(),
            requiredSec,
            dollars,
            weekdays: [...values.weekdays].sort(),
            startMinutes: startMinutes ?? 0,
            dueMinutes: dueMinutes ?? 0,
            // 時刻はこの画面のタイムゾーンで読む
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            error,
        };
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        const { error, projectName, ...request } = readForm();
        if (disabled || error) return;
        const first = upcoming(request, Date.now(), 1)[0];
        if (!confirm(
            `${sessionTitle({ projectName, tag: request.tag, requiredSec: request.requiredSec })}\n`
            + `${scheduleSummary(request)}、${targetLabel({ projectName, tag: request.tag })}を数えます。\n`
            + `届かなければ毎回 $${request.dollars} が課金されます。`
            + (first ? `\n最初の回は ${dateLabel(first.date)} です。` : "")
            + "\n\nカウント開始の前なら、その回だけ休めます。このスケジュールを作りますか？",
        )) return;

        setBusy(true);
        setMessage({ text: "", kind: "" });
        try {
            await createSchedule(request);
            setValues((v) => ({ ...v, weekdays: [] }));
            setMessage({ text: "スケジュールを作りました。カウント開始の時刻にセッションが始まります。", kind: "ok" });
        } catch (err) {
            setMessage({ text: (err as Error).message, kind: "error" });
        } finally {
            setBusy(false);
        }
    }

    const hint = form.error || `${scheduleSummary(form)}（${targetLabel(form)}）`;

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
