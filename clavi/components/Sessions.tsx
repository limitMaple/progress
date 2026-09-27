"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { signOut } from "firebase/auth";
import { deleteDoc, doc } from "firebase/firestore";
import { auth, db, callFunction } from "@/lib/firebase";
import { useSessions, useSettings, type Session } from "@/lib/account";
import {
    resolveDeadline, defaultDeadline, formatDuration, formatDay, formatDeadline,
} from "@/functions/src/progress.js";

const HOUR = 60 * 60 * 1000;

const startSession = callFunction<
    { tag: string; requiredSec: number; due: number; dollars: number },
    { id: string }
>("startSession");
const syncNow = callFunction<void, { done: string[] }>("syncNow");
const settleNow = callFunction<
    { id: string; resolve?: "charged" | "not_charged" },
    { status: string; message: string }
>("settleNow");

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

export default function Sessions({ uid }: { uid: string }) {
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
            <header className="app-header">
                <h1>Toggl Ratchet</h1>
                <div className="actions">
                    <button type="button" onClick={refresh} disabled={busy || !hasTokens}>↻ 更新</button>
                    <Link href="/settings" className="button icon" title="設定">⚙</Link>
                    <button type="button" className="link" onClick={() => signOut(auth)}>ログアウト</button>
                </div>
            </header>

            {settings && !hasTokens && (
                <p className="notice">
                    APIトークンが未設定です。<Link href="/settings">設定を開く</Link>
                </p>
            )}
            {settings?.dryRun && (
                <p className="notice">
                    テストモードです。失敗しても課金されません。<Link href="/settings">設定を開く</Link>
                </p>
            )}
            {message.text && <p className={`notice ${message.kind}`}>{message.text}</p>}

            <section>
                <h2>セッション</h2>
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
                    tags={settings.tags}
                    defaultDollars={settings.defaultDollars}
                    dryRun={settings.dryRun}
                    disabled={busy || !hasTokens}
                    setBusy={setBusy}
                    setMessage={setMessage}
                />
            )}
        </main>
    );
}

// ---- 新しいセッション ----

function NewSessionForm({ tags, defaultDollars, dryRun, disabled, setBusy, setMessage }: {
    tags: string[];
    defaultDollars: number;
    dryRun: boolean;
    disabled: boolean;
    setBusy: (busy: boolean) => void;
    setMessage: (message: Message) => void;
}) {
    const [tag, setTag] = useState("");
    const [deadline, setDeadline] = useState(() => defaultDeadline(Date.now(), 3 * HOUR));
    const [hours, setHours] = useState("2");
    const [minutes, setMinutes] = useState("0");
    const [dollars, setDollars] = useState(String(defaultDollars));
    useNow();

    const form = readForm();

    function readForm() {
        const now = Date.now();
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
        return { now, tag: tag.trim(), requiredSec, dollars: amount, due, error };
    }

    async function start(event: FormEvent) {
        event.preventDefault();
        const form = readForm();
        if (disabled || form.error || !form.due) return;

        const title = `${form.tag || "作業"} ${formatDuration(form.requiredSec)}`;
        const ok = confirm(
            `「${title}」を ${formatDeadline(form.due, form.now)} までにやります。`
            + `達成できなければ、Beeminderで$${form.dollars}が課金されます。よろしいですか？`
            + (dryRun ? "\n（今はテストモードなので、実際には課金されません）" : ""),
        );
        if (!ok) return;

        setBusy(true);
        setMessage({ text: "", kind: "" });
        try {
            await startSession({
                tag: form.tag,
                requiredSec: form.requiredSec,
                due: form.due,
                dollars: form.dollars,
            });
            setMessage({ text: "セッションを開始しました。Togglのタイマーを始めてください。", kind: "ok" });
        } catch (err) {
            setMessage({ text: (err as Error).message, kind: "error" });
        } finally {
            setBusy(false);
        }
    }

    const hint = form.error || !form.due
        ? form.error
        : `締切 ${formatDeadline(form.due, form.now)}（残り${formatDuration((form.due - form.now) / 1000)}）`
            + `までに${form.tag ? `「${form.tag}」を` : ""}${formatDuration(form.requiredSec)}`;

    return (
        <section>
            <h2>新しいセッション</h2>
            <form className="session-form" onSubmit={start} noValidate>
                <label>
                    <span>タグ</span>
                    <input
                        list="tag-options"
                        placeholder="空欄ならすべての記録"
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
                    {form.dollars >= 1 ? `開始（失敗したら$${form.dollars}）` : "開始"}
                </button>
            </form>
        </section>
    );
}

// ---- 一覧の 1 件 ----

const STATUS_LABELS = {
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

    async function settle(resolve?: "charged" | "not_charged") {
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
                {` ・ $${session.dollars}`}
                {session.tag ? ` ・ タグ「${session.tag}」` : " ・ タグ指定なし"}
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
