"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { deleteDoc, doc } from "firebase/firestore";
import { db, startSession, syncNow, settleNow, saveLastInput } from "@/lib/firebase";
import { useSessions, useSettings } from "@/lib/account";
import { useSignedInUser } from "@/components/AuthGate";
import {
    localDateTime, sessionTitle, formatDuration, formatDay, formatDeadline,
} from "@/functions/src/progress";
import { MAX_START_PAST_MS } from "@/functions/src/model";
import type {
    ChargeResolution, LastInput, Session, SessionStatus, Settings, StartSessionRequest, TogglProject,
} from "@/functions/src/model";

type Message = { text: string; kind: "" | "ok" | "error" };

/** 30 秒ごとに再描画して、残り時間の表示を進める（API は呼ばない）。 */
function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30 * 1000);
        return () => clearInterval(id);
    }, []);
    return now;
}

/** 何の記録を数えるか。「プロジェクト「資格」・タグ「過去問」」「すべての記録」の形。 */
function targetLabel({ projectName, tag }: { projectName?: string; tag: string }): string {
    const parts = [
        projectName ? `プロジェクト「${projectName}」` : "",
        tag ? `タグ「${tag}」` : "",
    ].filter(Boolean);
    return parts.length ? parts.join("・") : "すべての記録";
}

export default function Sessions() {
    const { uid } = useSignedInUser();
    const settings = useSettings(uid);
    const sessions = useSessions(uid);
    const now = useNow();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<Message>({ text: "", kind: "" });

    const hasTokens = Boolean(settings?.hasTogglToken && settings?.hasBeeminderToken);

    async function refresh() {
        if (busy) return;
        if (!sessions.some((s) => s.status === "active")) {
            setMessage({ text: "進行中のセッションはありません", kind: "" });
            return;
        }
        setBusy(true);
        setMessage({ text: "", kind: "" });
        try {
            const result = await syncNow();
            if (result.done.length) {
                setMessage({ text: `達成しました: ${result.done.join("、")}`, kind: "ok" });
            }
        } catch (err) {
            setMessage({ text: (err as Error).message, kind: "error" });
        } finally {
            setBusy(false);
        }
    }

    return (
        <main>
            {settings && !hasTokens && (
                <p className="notice">
                    APIトークンが未設定です。<Link href="/settings">設定を開く</Link>
                </p>
            )}
            {message.text && <p className={`notice ${message.kind}`}>{message.text}</p>}

            <section>
                <div className="section-head">
                    <h2>セッション</h2>
                    <button type="button" onClick={refresh} disabled={busy || !hasTokens}>↻ 更新</button>
                </div>
                <ul className="session-list">
                    {sessions.map((session) => (
                        <SessionItem
                            key={session.id}
                            uid={uid}
                            session={session}
                            now={now}
                            busy={busy}
                            setBusy={setBusy}
                            setMessage={setMessage}
                        />
                    ))}
                </ul>
                {sessions.length === 0 && <p className="muted">セッションはまだありません</p>}
            </section>

            {settings && (
                <NewSessionForm
                    initial={initialValues(settings)}
                    projects={settings.projects}
                    tags={settings.tags}
                    disabled={busy || !hasTokens}
                    setBusy={setBusy}
                    setMessage={setMessage}
                />
            )}
        </main>
    );
}

// ---- 新しいセッション ----

/** 確認画面に出す、開始しようとしている内容。 */
type Draft = StartSessionRequest & { projectName: string };

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

/** 入力欄の初期値。最後に入力した値があればそれ、なければ空（数値は 0）。 */
function initialValues(settings: Settings): FormValues {
    const last = settings.lastInput;
    const requiredSec = last?.requiredSec ?? 0;
    // 前回のプロジェクトが今は選べない（アーカイブした等）なら「指定なし」に戻す
    const projectId = last?.projectId != null && settings.projects.some((p) => p.id === last.projectId)
        ? String(last.projectId)
        : "";
    return {
        projectId,
        tag: last?.tag ?? "",
        startDate: last?.startDate ?? "",
        startTime: last?.startTime ?? "",
        deadlineDate: last?.deadlineDate ?? "",
        deadlineTime: last?.deadlineTime ?? "",
        hours: String(Math.floor(requiredSec / 3600)),
        minutes: String(Math.floor((requiredSec % 3600) / 60)),
        dollars: String(last?.dollars ?? 0),
    };
}

function toLastInput(values: FormValues): LastInput {
    return {
        projectId: values.projectId ? Number(values.projectId) : null,
        tag: values.tag,
        startDate: values.startDate,
        startTime: values.startTime,
        deadlineDate: values.deadlineDate,
        deadlineTime: values.deadlineTime,
        requiredSec: (Number(values.hours) || 0) * 3600 + (Number(values.minutes) || 0) * 60,
        dollars: Math.floor(Number(values.dollars) || 0),
    };
}

// 1 文字ごとに保存しないよう、入力がこの時間止まってから保存する
const SAVE_DELAY = 800;

function saveNow(values: FormValues) {
    // 保存できなくても入力は続けられるので、画面には出さない
    saveLastInput(toLastInput(values)).catch((err) => console.warn("入力の保存に失敗しました", err));
}

/**
 * 入力が止まったら、最後の入力として保存する（次に入力欄を開いたときの初期値になる）。
 * 画面を離れるときに保存待ちの入力があれば、その場で保存する。
 */
function useSaveLastInput(values: FormValues) {
    const pending = useRef<FormValues | null>(null);
    const isFirst = useRef(true);

    useEffect(() => {
        // 最初の描画は保存済みの値（初期値）そのものなので、保存し直さない
        if (isFirst.current) {
            isFirst.current = false;
            return;
        }
        pending.current = values;
        const timer = setTimeout(() => {
            pending.current = null;
            saveNow(values);
        }, SAVE_DELAY);
        return () => clearTimeout(timer);
    }, [values]);

    useEffect(() => () => {
        if (pending.current) saveNow(pending.current);
    }, []);
}

/**
 * 新しいセッションの入力欄。
 * initial は作るときに 1 回だけ使う（あとで設定が変わっても、入力中の値は上書きしない）。
 * projects と tags は選択肢なので、設定が変われば追従する。
 */
function NewSessionForm({ initial, projects, tags, disabled, setBusy, setMessage }: {
    initial: FormValues;
    projects: TogglProject[];
    tags: string[];
    disabled: boolean;
    setBusy: (busy: boolean) => void;
    setMessage: (message: Message) => void;
}) {
    const [values, setValues] = useState(initial);
    const [draft, setDraft] = useState<Draft | null>(null);
    useSaveLastInput(values);
    // 残り時間の表示を進めるためだけに、30 秒ごとに描き直す
    useNow();

    const change = (key: keyof FormValues) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { value } = e.target;
        setValues((v) => ({ ...v, [key]: value }));
    };

    const form = readForm();

    function readForm() {
        const now = Date.now();
        const project = projects.find((p) => String(p.id) === values.projectId) ?? null;
        const requiredSec = (Number(values.hours) || 0) * 3600 + (Number(values.minutes) || 0) * 60;
        const amount = Math.floor(Number(values.dollars) || 0);
        // カウント開始は空欄なら null（開始した時刻から数える）。日付だけならその日の 0:00
        const startAt = values.startDate ? localDateTime(values.startDate, values.startTime) : null;
        const due = values.deadlineTime ? localDateTime(values.deadlineDate, values.deadlineTime) : null;
        const countFrom = startAt ?? now;

        let error = "";
        if (values.startTime && !values.startDate) error = "カウント開始の日付を入力してください";
        else if (!due) error = "締切の日付と時刻を入力してください";
        else if (due <= now) error = "締切が過ぎています";
        else if (startAt != null && startAt < now - MAX_START_PAST_MS) error = "カウント開始は30日前までにしてください";
        else if (requiredSec <= 0) error = "作業時間を入力してください";
        else if (amount < 1) error = "金額は$1以上にしてください";
        else if (due - countFrom < requiredSec * 1000) {
            error = `カウント開始から締切まで${formatDuration((due - countFrom) / 1000)}しかありません`;
        }
        return { now, project, tag: values.tag.trim(), requiredSec, dollars: amount, startAt, due, error };
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
                        list="tag-options"
                        placeholder="空欄ならタグで絞らない"
                        autoComplete="off"
                        value={values.tag}
                        onChange={change("tag")}
                    />
                </label>
                <datalist id="tag-options">
                    {tags.map((name) => <option key={name} value={name} />)}
                </datalist>

                <label>
                    <span>カウント開始</span>
                    <span className="row">
                        <input type="date" value={values.startDate} onChange={change("startDate")} />
                        <input type="time" value={values.startTime} onChange={change("startTime")} />
                    </span>
                </label>
                <p className="field-note muted">空欄なら開始した時刻から数えます。日付だけなら、その日の 0:00 から。</p>

                <label>
                    <span>締切</span>
                    <span className="row">
                        <input type="date" required value={values.deadlineDate} onChange={change("deadlineDate")} />
                        <input type="time" required value={values.deadlineTime} onChange={change("deadlineTime")} />
                        <span className="muted">{form.due ? formatDay(form.due, form.now) : ""}</span>
                    </span>
                </label>

                <label>
                    <span>作業時間</span>
                    <span className="row">
                        <input
                            type="number" min="0" max="99" className="num"
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
                    内容を確認する
                </button>
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

const WEEKDAYS = "日月火水木金土";

/** 「9/30（火）」の形。 */
function formatDate(ms: number): string {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

/** 「9:05」の形。 */
function formatClock(ms: number): string {
    const d = new Date(ms);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 開始前の確認画面。開始したあとは内容を変えられないので、締切とカウント開始を
 * 取り違えていないか（日付を 1 日ずらしていないか、など）をここで大きく見せる。
 */
function StartConfirmDialog({ draft, busy, onBack, onStart }: {
    draft: Draft;
    busy: boolean;
    onBack: () => void;
    onStart: () => void;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        ref.current?.showModal();
    }, []);

    const now = Date.now();
    const day = formatDay(draft.due, now);

    return (
        // Esc で閉じたときも「戻って直す」と同じ扱いにする
        <dialog ref={ref} className="confirm" onCancel={onBack} aria-labelledby="confirm-title">
            <h2 id="confirm-title">この内容で開始しますか？</h2>
            <p className="confirm-title">{sessionTitle(draft)}</p>

            <div className={`confirm-deadline ${day === "今日" ? "" : "not-today"}`}>
                <span className="confirm-label">締切</span>
                <span className="confirm-day">{day === "今日" ? "今日" : `${day === "明日" ? "明日 " : ""}${formatDate(draft.due)}`}</span>
                <span className="confirm-clock">{formatClock(draft.due)}</span>
                <span className="muted">残り{formatDuration((draft.due - now) / 1000)}</span>
            </div>

            <dl className="confirm-list">
                <dt>カウント開始</dt>
                <dd>
                    {draft.startAt == null
                        ? "開始した時刻から"
                        : `${formatDate(draft.startAt)} ${formatClock(draft.startAt)} から`}
                </dd>
                <dt>作業時間</dt>
                <dd>{formatDuration(draft.requiredSec)}</dd>
                <dt>数える記録</dt>
                <dd>{targetLabel(draft)}</dd>
                <dt>金額</dt>
                <dd>${draft.dollars}</dd>
            </dl>

            <p className="confirm-warning">
                開始したあとは変更できません。締切までに届かなければ、Beeminder で ${draft.dollars} が課金されます。
            </p>

            <div className="confirm-buttons">
                <button type="button" onClick={onBack} disabled={busy} autoFocus>戻って直す</button>
                <button type="button" className="primary" onClick={onStart} disabled={busy}>
                    {busy ? "開始しています…" : "この内容で開始"}
                </button>
            </div>
        </dialog>
    );
}

// ---- 一覧の 1 件 ----

// settling は「締切を過ぎた active」（精算を待っている）の表示用
const STATUS_LABELS: Record<SessionStatus | "settling", string> = {
    active: "進行中",
    settling: "精算待ち",
    done: "達成",
    charged: "課金済み",
    error: "要確認",
};

function SessionItem({ uid, session, now, busy, setBusy, setMessage }: {
    uid: string;
    session: Session;
    now: number;
    busy: boolean;
    setBusy: (busy: boolean) => void;
    setMessage: (message: Message) => void;
}) {
    const status = session.status === "active" && now >= session.due ? "settling" : session.status;
    const remainingTime = session.due - now;
    const ratio = Math.min(1, session.trackedSec / session.requiredSec);
    const left = session.requiredSec - session.trackedSec;
    // 課金 API の途中で失敗して、課金されたか分からない。人が Beeminder の履歴で確かめる
    const unresolved = Boolean(session.chargeRequestedAt) && !session.charge && now >= session.due;

    async function settle(resolve?: ChargeResolution) {
        if (busy) return;
        if (resolve === "not_charged" && !confirm(
            `Beeminderの課金履歴に「${session.title}」の$${session.dollars}が無いことを確かめましたか？`
            + "\nもう一度課金を試みます。",
        )) return;
        setBusy(true);
        setMessage({ text: "", kind: "" });
        try {
            const result = await settleNow({ id: session.id, resolve });
            setMessage({ text: result.message, kind: result.status === "error" ? "error" : "ok" });
        } catch (err) {
            setMessage({ text: (err as Error).message, kind: "error" });
        } finally {
            setBusy(false);
        }
    }

    return (
        <li className={`session ${session.status}`}>
            <div className="session-head">
                <span className="title">{session.title}</span>
                <span className={`badge ${status}`}>{STATUS_LABELS[status]}</span>
            </div>
            <div className="deadline muted">
                {/* カウント開始を指定したセッションだけ出す（指定しなければ作成時刻と同じ） */}
                {session.startAt !== session.createdAt ? `${formatDeadline(session.startAt, now)}〜` : ""}
                {`締切 ${formatDeadline(session.due, now)}`}
                {session.status === "active" && remainingTime > 0 ? `（残り${formatDuration(remainingTime / 1000)}）` : ""}
                {` ・ $${session.dollars} ・ ${targetLabel(session)}`}
            </div>
            <div className="bar"><div className="fill" style={{ width: `${ratio * 100}%` }} /></div>
            <div className="session-foot">
                <span className="amount">
                    {`${formatDuration(session.trackedSec)} / ${formatDuration(session.requiredSec)}`}
                </span>
                {/* 「あと0分」と出ないよう、残りは分単位で切り上げる */}
                <span>{left > 0 ? `あと${formatDuration(Math.ceil(left / 60) * 60)}` : "達成"}</span>
            </div>
            {session.settle?.message && <div className="auto-check">{session.settle.message}</div>}
            <div className="session-foot">
                <span className="updated muted">
                    {session.updatedAt ? `最終更新 ${formatDeadline(session.updatedAt, now)}` : "未更新"}
                </span>
                {unresolved && (
                    <span className="actions">
                        <button type="button" className="link" onClick={() => settle("charged")} disabled={busy}>
                            課金されていた
                        </button>
                        <button type="button" className="link" onClick={() => settle("not_charged")} disabled={busy}>
                            されていなかった
                        </button>
                    </span>
                )}
                {session.status === "error" && !unresolved && (
                    <button type="button" className="link" onClick={() => settle()} disabled={busy}>精算する</button>
                )}
                {(session.status === "done" || session.status === "charged") && (
                    <button
                        type="button"
                        className="link"
                        onClick={() => deleteDoc(doc(db, "users", uid, "sessions", session.id))}
                    >
                        一覧から消す
                    </button>
                )}
            </div>
        </li>
    );
}
