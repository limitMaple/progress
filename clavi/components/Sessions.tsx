"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { deleteDoc, doc } from "firebase/firestore";
import { db, startSession, syncNow, settleNow } from "@/lib/firebase";
import { useSessions, useSettings } from "@/lib/account";
import { useSignedInUser } from "@/components/AuthGate";
import {
    resolveDeadline, defaultDeadline, sessionTitle, formatDuration, formatDay, formatDeadline,
} from "@/functions/src/progress";
import type {
    ChargeResolution, Session, SessionStatus, StartSessionRequest, TogglProject,
} from "@/functions/src/model";

const HOUR = 60 * 60 * 1000;

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
                    projects={settings.projects}
                    tags={settings.tags}
                    defaultDollars={settings.defaultDollars}
                    disabled={busy || !hasTokens}
                    setBusy={setBusy}
                    setMessage={setMessage}
                />
            )}
        </main>
    );
}

// ---- 新しいセッション ----

/** 確認画面に出す、開始しようとしている内容。締切は確認画面を開いた時点で決める。 */
type Draft = StartSessionRequest & { projectName: string };

function NewSessionForm({ projects, tags, defaultDollars, disabled, setBusy, setMessage }: {
    projects: TogglProject[];
    tags: string[];
    defaultDollars: number;
    disabled: boolean;
    setBusy: (busy: boolean) => void;
    setMessage: (message: Message) => void;
}) {
    const [projectId, setProjectId] = useState("");
    const [tag, setTag] = useState("");
    const [deadline, setDeadline] = useState(() => defaultDeadline(Date.now(), 3 * HOUR));
    const [hours, setHours] = useState("2");
    const [minutes, setMinutes] = useState("0");
    const [dollars, setDollars] = useState(String(defaultDollars));
    const [draft, setDraft] = useState<Draft | null>(null);
    useNow();

    const form = readForm();

    function readForm() {
        const now = Date.now();
        const project = projects.find((p) => String(p.id) === projectId) ?? null;
        const requiredSec = (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60;
        const amount = Math.floor(Number(dollars) || 0);
        const due = deadline ? resolveDeadline(deadline, now) : null;

        let error = "";
        if (!due) error = "締切を入力してください";
        else if (requiredSec <= 0) error = "作業時間を入力してください";
        else if (amount < 1) error = "金額は$1以上にしてください";
        else if (due - now < requiredSec * 1000) {
            error = `締切まで残り${formatDuration((due - now) / 1000)}しかありません`;
        }
        return { now, project, tag: tag.trim(), requiredSec, dollars: amount, due, error };
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
            due: form.due,
            dollars: form.dollars,
        });
    }

    async function start(draft: Draft) {
        // 確認画面を開いたまま時間が経つと、作業時間が締切に収まらなくなることがある
        if (draft.due - Date.now() < draft.requiredSec * 1000) {
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
        : `締切 ${formatDeadline(form.due, form.now)}（残り${formatDuration((form.due - form.now) / 1000)}）`
            + `までに${targetLabel({ projectName: form.project?.name, tag: form.tag })}を${formatDuration(form.requiredSec)}`;

    return (
        <section>
            <h2>新しいセッション</h2>
            <form className="session-form" onSubmit={review} noValidate>
                <label>
                    <span>プロジェクト</span>
                    <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
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
                        value={tag}
                        onChange={(e) => setTag(e.target.value)}
                    />
                </label>
                <datalist id="tag-options">
                    {tags.map((name) => <option key={name} value={name} />)}
                </datalist>

                <label>
                    <span>締切</span>
                    <span className="row">
                        <input type="time" required value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                        <span className="muted">{form.due ? formatDay(form.due, form.now) : ""}</span>
                    </span>
                </label>

                <label>
                    <span>作業時間</span>
                    <span className="row">
                        <input
                            type="number" min="0" max="99" className="num"
                            value={hours} onChange={(e) => setHours(e.target.value)}
                        />時間
                        <input
                            type="number" min="0" max="59" step="5" className="num"
                            value={minutes} onChange={(e) => setMinutes(e.target.value)}
                        />分
                    </span>
                </label>

                <label>
                    <span>金額</span>
                    <span className="row">
                        $<input
                            type="number" min="1" step="1" className="num"
                            value={dollars} onChange={(e) => setDollars(e.target.value)}
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

/**
 * 開始前の確認画面。開始したあとは内容を変えられないので、締切を取り違えていないか
 * （特に、時刻が過ぎていて翌日扱いになっていないか）をここで大きく見せる。
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
    const d = new Date(draft.due);
    const day = formatDay(draft.due, now);
    const date = `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
    const clock = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;

    return (
        // Esc で閉じたときも「戻って直す」と同じ扱いにする
        <dialog ref={ref} className="confirm" onCancel={onBack} aria-labelledby="confirm-title">
            <h2 id="confirm-title">この内容で開始しますか？</h2>
            <p className="confirm-title">{sessionTitle(draft)}</p>

            <div className={`confirm-deadline ${day === "今日" ? "" : "not-today"}`}>
                <span className="confirm-label">締切</span>
                <span className="confirm-day">{day === "今日" ? "今日" : `${day === "明日" ? "明日 " : ""}${date}`}</span>
                <span className="confirm-clock">{clock}</span>
                <span className="muted">残り{formatDuration((draft.due - now) / 1000)}</span>
            </div>

            <dl className="confirm-list">
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
