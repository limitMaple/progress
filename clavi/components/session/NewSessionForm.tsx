"use client";

import { useState, type FormEvent } from "react";
import { startSession } from "@/lib/firebase";
import { localDateTime, formatDuration, formatDay, formatDeadline } from "@/functions/src/progress";
import { MAX_START_PAST_MS } from "@/functions/src/model";
import type { StartSessionRequest } from "@/functions/src/model";
import { useNow, targetLabel, type FormProps } from "@/components/session/common";
import StartConfirmDialog from "@/components/session/StartConfirmDialog";
import {
    DollarsField, DurationField, ProjectField, SubmitRow, TagField,
    dollarsOf, durationValues, requiredSecOf, useFormValues,
} from "@/components/session/fields";

const MIN = 60 * 1000;
// 手で作るセッションは日をまたいでもよいので、作業時間は 99 時間まで
const MAX_HOURS = 99;

/** 確認画面に出す、開始しようとしている内容。 */
export type Draft = StartSessionRequest & { projectName: string };

/** 入力欄の値。どれも input / select の value なので文字列で持つ（日付は "YYYY-MM-DD"、時刻は "HH:MM"）。 */
type FormValues = {
    projectId: string;
    tag: string;
    startDate: string;
    startTime: string;
    deadlineDate: string;
    deadlineTime: string;
    /** 取り消せる期限（カウント開始の何分前か）。空欄なら取り消せない */
    cancelMinutes: string;
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
        cancelMinutes: "",
        ...durationValues(requiredSec),
        dollars: "0",
    };
}

/** 新しいセッションの入力欄。開始する前に確認画面（StartConfirmDialog）を出す。 */
export default function NewSessionForm({ initialRequiredSec, projects, tags, disabled, setBusy, setMessage }: FormProps) {
    const { values, change } = useFormValues(() => initialValues(initialRequiredSec));
    const [draft, setDraft] = useState<Draft | null>(null);
    // 残り時間の表示を進めるためだけに、30 秒ごとに描き直す
    useNow();

    const form = readForm();

    function readForm() {
        const now = Date.now();
        const project = projects.find((p) => String(p.id) === values.projectId) ?? null;
        const requiredSec = requiredSecOf(values);
        const amount = dollarsOf(values);
        // カウント開始は空欄なら null（開始した時刻から数える）。日付だけならその日の 0:00
        const startAt = values.startDate ? localDateTime(values.startDate, values.startTime) : null;
        const due = values.deadlineTime ? localDateTime(values.deadlineDate, values.deadlineTime) : null;
        const countFrom = startAt ?? now;
        const cancelMinutes = values.cancelMinutes.trim() === "" ? null : Number(values.cancelMinutes);

        let error = "";
        if (values.startTime && !values.startDate) error = "カウント開始の日付を入力してください";
        else if (!due) error = "締切の日付と時刻を入力してください";
        else if (due <= now) error = "締切が過ぎています";
        else if (startAt != null && startAt < now - MAX_START_PAST_MS) error = "カウント開始は30日前までにしてください";
        else if (requiredSec <= 0) error = "作業時間を入力してください";
        else if (amount < 1) error = "金額は$1以上にしてください";
        else if (cancelMinutes != null && !(Number.isInteger(cancelMinutes) && cancelMinutes >= 0)) {
            error = "取り消せる期限は、0以上の分で入力してください";
        } else if (cancelMinutes != null && countFrom - cancelMinutes * MIN <= now) {
            error = "取り消せる期限がもう過ぎています。カウント開始を先にするか、取り消しを空欄にしてください";
        } else if (due - countFrom < requiredSec * 1000) {
            error = `カウント開始から締切まで${formatDuration((due - countFrom) / 1000)}しかありません`;
        }
        return { now, project, tag: values.tag.trim(), requiredSec, dollars: amount, startAt, due, cancelMinutes, error };
    }

    /** 開始ボタン。すぐには始めず、確認画面を開く。 */
    function review(event: FormEvent) {
        event.preventDefault();
        const form = readForm();
        if (disabled || form.error || !form.due) return;
        setDraft({
            projectId: form.project?.id ?? null,
            projectName: form.project?.name ?? "",
            tag: form.tag,
            requiredSec: form.requiredSec,
            startAt: form.startAt,
            due: form.due,
            dollars: form.dollars,
            cancelMinutes: form.cancelMinutes,
        });
    }

    async function start(draft: Draft) {
        // 確認画面を開いたまま時間が経つと、作業時間が締切に収まらなくなることがある
        const now = Date.now();
        if (draft.due <= now || draft.due - (draft.startAt ?? now) < draft.requiredSec * 1000) {
            setDraft(null);
            setMessage({ text: "確認している間に、締切までに作業時間が収まらなくなりました。直してください。", kind: "error" });
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
                cancelMinutes: draft.cancelMinutes,
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

    const hint = form.error || !form.due
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
                <p className="field-note muted">空欄なら開始した時刻から数えます。日付だけなら、その日の 0:00 から。</p>

                <label>
                    <span>取り消し</span>
                    <span className="row">
                        カウント開始の
                        <input
                            type="number" min="0" step="5" className="num" placeholder="—"
                            value={values.cancelMinutes} onChange={change("cancelMinutes")}
                        />分前まで
                    </span>
                </label>
                <p className="field-note muted">空欄なら取り消せません。カウント開始が空欄（開始した時刻から）のときも取り消せません。</p>

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
