"use client";

import { type FormEvent } from "react";
import Link from "next/link";
import { createSchedule } from "@/lib/firebase";
import { sessionTitle } from "@/functions/src/progress";
import { dateLabel, parseClock, zonedDate } from "@/functions/src/calendar";
import { cancelLabel } from "@/functions/src/cancel";
import { Schedule } from "@/functions/src/schedule";
import type { CreateScheduleRequest, RecurrenceData } from "@/functions/src/model";
import { checkInput, targetLabel, type FormProps } from "@/components/session/common";
import RecurrenceFields, { RECURRENCE_EDITORS } from "@/components/session/RecurrenceFields";
import {
    DollarsField, DurationField, ProjectField, SubmitRow, TagField,
    dollarsOf, durationValues, requiredSecOf, useFormValues,
} from "@/components/session/fields";

// 1 回のセッションは日をまたいでも 1 日に収まるので、作業時間は 23 時間まで
const MAX_HOURS = 23;

type FormValues = {
    projectId: string;
    tag: string;
    /** 繰り返しのきまり。入力欄は RecurrenceFields */
    repeat: RecurrenceData;
    startTime: string;
    deadlineTime: string;
    hours: string;
    minutes: string;
    dollars: string;
};

/** この画面のタイムゾーン。スケジュールの時刻はこれで読む。 */
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function initialValues(requiredSec: number): FormValues {
    return {
        projectId: "",
        tag: "",
        repeat: RECURRENCE_EDITORS.weekly.initial({ from: zonedDate(Date.now(), browserTimeZone()), interval: 1 }),
        startTime: "",
        deadlineTime: "",
        ...durationValues(requiredSec),
        dollars: "0",
    };
}

/**
 * 新しいスケジュールの入力欄。各回のセッションは、取り消せる期限の 1 日前に作られる。
 * 取り消し猶予はここでは決めず、設定の値（cancelMinutes）に従う。
 */
export default function NewScheduleForm(
    { initialRequiredSec, projects, tags, cancelMinutes, now, disabled, setBusy, setMessage }: FormProps,
) {
    const { values, setValues, change } = useFormValues(() => initialValues(initialRequiredSec));

    const form = readForm(now);

    /** 送る値と、それで作られるスケジュール（作ったらどうなるかを見せる）。正しくなければ error。 */
    function readForm(now: number) {
        const project = projects.find((p) => String(p.id) === values.projectId) ?? null;
        const fields = {
            tag: values.tag.trim(),
            requiredSec: requiredSecOf(values),
            dollars: dollarsOf(values),
            repeat: values.repeat,
            // 空欄は NaN にして、Schedule.create に「入力してください」と言わせる
            startMinutes: parseClock(values.startTime) ?? NaN,
            dueMinutes: parseClock(values.deadlineTime) ?? NaN,
            timeZone: browserTimeZone(),
        };
        const request: CreateScheduleRequest = { projectId: project?.id ?? null, ...fields };
        // 保存はせずに Functions と同じ計算をする（中身の確かめ方も同じ。取り消し猶予は Functions も設定から取る）
        const { value: schedule, error } = checkInput(
            () => Schedule.create({ id: "preview", now, project, ...fields, cancelMinutes }),
        );
        return { request, schedule, error };
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        const { error, request, schedule } = readForm(Date.now());
        if (disabled || error || !schedule) return;
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

    const hint = form.schedule
        ? `${form.schedule.summary}（${targetLabel(form.schedule)}）。`
            + `最初の回は ${dateLabel(form.schedule.nextDate!)}。${form.schedule.cancelLabel}`
        : form.error;

    return (
        <section>
            <h2>新しいスケジュール</h2>
            <form className="session-form" onSubmit={submit} noValidate>
                <ProjectField values={values} change={change} projects={projects} />
                <TagField values={values} change={change} tags={tags} />

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

                <div className="field">
                    <span className="muted">取り消し</span>
                    <span>
                        {cancelLabel(cancelMinutes)}（<Link href="/settings">設定</Link>で変えられます）
                    </span>
                </div>
                <p className="field-note muted">休みたい回は、この期限までにそのセッションを取り消します。</p>

                <DurationField values={values} change={change} maxHours={MAX_HOURS} />
                <DollarsField values={values} change={change} />

                <SubmitRow hint={hint} error={form.error} disabled={disabled}>スケジュールを作る</SubmitRow>
            </form>
        </section>
    );
}
