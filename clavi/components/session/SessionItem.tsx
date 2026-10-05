"use client";

import { deleteDoc, doc } from "firebase/firestore";
import { db, settleNow } from "@/lib/firebase";
import { formatDuration, formatDeadline } from "@/functions/src/progress";
import type { ChargeResolution } from "@/functions/src/model";
import type { DisplayStatus, Session } from "@/functions/src/session";
import { targetLabel, type Message } from "@/components/session/common";

const STATUS_LABELS: Record<DisplayStatus, string> = {
    active: "進行中",
    settling: "精算待ち",
    done: "達成",
    charged: "課金済み",
    error: "要確認",
};

export default function SessionItem({ uid, session, now, busy, setBusy, setMessage }: {
    uid: string;
    session: Session;
    now: number;
    busy: boolean;
    setBusy: (busy: boolean) => void;
    setMessage: (message: Message) => void;
}) {
    const status = session.displayStatus(now);
    const remainingTime = session.remainingMs(now);
    const left = session.leftSec;
    const unresolved = session.isChargeUnknown;

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
                {/* カウント開始を指定したセッションだけ出す */}
                {session.hasCustomStart ? `${formatDeadline(session.startAt, now)}〜` : ""}
                {`締切 ${formatDeadline(session.due, now)}`}
                {session.status === "active" && remainingTime > 0 ? `（残り${formatDuration(remainingTime / 1000)}）` : ""}
                {` ・ $${session.dollars} ・ ${targetLabel(session)}`}
            </div>
            <div className="bar"><div className="fill" style={{ width: `${session.progressRatio * 100}%` }} /></div>
            <div className="session-foot">
                <span className="amount">{session.progressLabel()}</span>
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
                {session.isSettled && (
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
