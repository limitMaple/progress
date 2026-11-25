"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { startSession } from "@/lib/firebase";
import { localDateTime, formatDuration, formatDay, formatDeadline } from "@/functions/src/progress";
import { cancelableUntilFor, cancelLabel } from "@/functions/src/cancel";
import { validateSessionTerms } from "@/functions/src/session";
import type { StartSessionRequest } from "@/functions/src/model";
import { checkInput, targetLabel, type FormProps } from "@/components/session/common";
import StartConfirmDialog from "@/components/session/StartConfirmDialog";
import {
    DollarsField, DurationField, ProjectField, SubmitRow, TagField,
    dollarsOf, durationValues, requiredSecOf, useFormValues,
} from "@/components/session/fields";

// 手で作るセッションは日をまたいでもよいので、作業時間は 99 時間まで
const MAX_HOURS = 99;

/** 確認画面に出す、開始しようとしている内容。 */
export type Draft = StartSessionRequest & {
    projectName: string;
    /** 取り消せる期限。取り消せないなら null */
    cancelableUntil: number | null;
};

/** 入力欄の値。どれも input / select の value なので文字列で持つ（日付は "YYYY-MM-DD"、時刻は "HH:MM"）。 */
type FormValues = {
    projectId: string;
    tag: string;
    startDate: string;
    startTime: string;
    deadlineDate: string;
    deadlineTime: string;
    hours: string;
    minutes: string;
    dollars: string;
};

/** 入力欄の初期値。作業時間だけは最後に開始したセッションのものを使う。 */
function initialValues(requiredSec: number): FormValues {
    return {
        projectId: "",
        tag: "",
        startDate: "",
        startTime: "",
        deadlineDate: "",
        deadlineTime: "",
        ...durationValues(requiredSec),
        dollars: "0",
    };
}

/**
 * 新しいセッションの入力欄。開始する前に確認画面（StartConfirmDialog）を出す。
 * 取り消し猶予はここでは決めず、設定の値（cancelMinutes）に従う。
 */
export default function NewSessionForm(
    { initialRequiredSec, projects, tags, cancelMinutes, now, disabled, setBusy, setMessage }: FormProps,
) {
    const { values, change } = useFormValues(() => initialValues(initialRequiredSec));
    const [draft, setDraft] = useState<Draft | null>(null);

    const form = readForm(now);

    function readForm(now: number) {
        const project = projects.find((p) => String(p.id) === values.projectId) ?? null;
        const requiredSec = requiredSecOf(values);
        const dollars = dollarsOf(values);
        // カウント開始は空欄なら null（開始した時刻から数える）。日付だけならその日の 0:00
        const startAt = values.startDate ? localDateTime(values.startDate, values.startTime) : null;
        const due = values.deadlineTime ? localDateTime(values.deadlineDate, values.deadlineTime) : null;
        const fields = {
            now, project, tag: values.tag.trim(), requiredSec, dollars, startAt, due,
            cancelableUntil: cancelableUntilFor(startAt, cancelMinutes, now),
        };

        // 入力欄の形の誤りを先に見て、中身は Functions と同じもので確かめる
        if (values.startTime && !values.startDate) return { ...fields, error: "カウント開始の日付を入力してください" };
        if (due == null) return { ...fields, error: "締切の日付と時刻を入力してください" };
        return { ...fields, error: checkInput(() => validateSessionTerms({ requiredSec, startAt, due, dollars }, now)).error };
    }

    /** 開始ボタン。すぐには始めず、確認画面を開く。 */
    function review(event: FormEvent) {
        event.preventDefault();
        const form = readForm(Date.now());
        if (disabled || form.error || form.due == null) return;
        setDraft({
            projectId: form.project?.id ?? null,
            projectName: form.project?.name ?? "",
            tag: form.tag,
            requiredSec: form.requiredSec,
            startAt: form.startAt,
            due: form.due,
            dollars: form.dollars,
            cancelableUntil: form.cancelableUntil,
        });
    }

    async function start(draft: Draft) {
        // 確認画面を開いたまま時間が経つと、作業時間が締切に収まらなくなることがある
        const { error } = checkInput(() => validateSessionTerms(draft, Date.now()));
        if (error) {
            setDraft(null);
            setMessage({ text: `確認している間に時間が経ちました。直してください: ${error}`, kind: "error" });
            return;
        }
        setBusy(true);
        setMessage({ text: "", kind: "" });
        try {
            await startSession({
                projectId: draft.projectId,
                tag: draft.tag,
                requiredSec: draft.requiredSec,
                startAt: draft.startAt,
                due: draft.due,
                dollars: draft.dollars,
            });
            setDraft(null);
            setMessage({ text: "セッションを開始しました。Togglのタイマーを始めてください。", kind: "ok" });
        } catch (err) {
            setDraft(null);
            setMessage({ text: (err as Error).message, kind: "error" });
        } finally {
            setBusy(false);
        }
    }

    const hint = form.error || form.due == null
        ? form.error
        : `${form.startAt == null ? "開始した時刻" : formatDeadline(form.startAt, form.now)}から`
            + `締切 ${formatDeadline(form.due, form.now)}（残り${formatDuration((form.due - form.now) / 1000)}）までに`
            + `${targetLabel({ projectName: form.project?.name, tag: form.tag })}を${formatDuration(form.requiredSec)}`;

    return (
        <section>
            <h2>新しいセッション</h2>
            <form className="session-form" onSubmit={review} noValidate>
                <ProjectField values={values} change={change} projects={projects} />
                <TagField values={values} change={change} tags={tags} />

                <label>
                    <span>カウント開始</span>
                    <span className="row">
                        <input type="date" value={values.startDate} onChange={change("startDate")} />
                        <input type="time" value={values.startTime} onChange={change("startTime")} />
                    </span>
                </label>
                <p className="field-note muted">
                    空欄なら開始した時刻から数えます。日付だけなら、その日の 0:00 から。
                    {` ${cancelLabel(cancelMinutes)}`}（<Link href="/settings">設定</Link>で変えられます）。
                    空欄のときと、期限がもう過ぎているときは取り消せません。
                </p>

                <label>
                    <span>締切</span>
                    <span className="row">
                        <input type="date" required value={values.deadlineDate} onChange={change("deadlineDate")} />
                        <input type="time" required value={values.deadlineTime} onChange={change("deadlineTime")} />
                        <span className="muted">{form.due ? formatDay(form.due, form.now) : ""}</span>
                    </span>
                </label>

                <DurationField values={values} change={change} maxHours={MAX_HOURS} />
                <DollarsField values={values} change={change} />

                <SubmitRow hint={hint} error={form.error} disabled={disabled}>内容を確認する</SubmitRow>
            </form>

            {draft && (
                <StartConfirmDialog
                    draft={draft}
                    busy={disabled}
                    onBack={() => setDraft(null)}
                    onStart={() => start(draft)}
                />
            )}
        </section>
    );
}
