"use client";

import { cancelSession, settleNow } from "@/lib/firebase";
import { deleteSession } from "@/lib/account";
import { formatDuration, formatDeadline } from "@/functions/src/format";
import type { ChargeResolution } from "@/functions/src/requests";
import type { Session } from "@/functions/src/session";
import {
    displayStatus, hasCustomStart, progressLabel, progressRatio, type DisplayStatus,
} from "@/functions/src/sessionView";
import { targetLabel } from "@/functions/src/format";
import { type ItemProps } from "@/components/session/types";
import { useActivity } from "@/components/session/activity";

const STATUS_LABELS: Record<DisplayStatus, string> = {
    waiting: "開始前",
    active: "進行中",
    settling: "精算待ち",
    done: "達成",
    charged: "課金済み",
    error: "要確認",
    canceled: "取り消し",
};

/** セッション 1 件。 */
export default function SessionItem({ item: session, now }: ItemProps<Session>) {
    const { busy, run } = useActivity();
    const status = displayStatus(session, now);
    const remainingTime = session.due - now;
    const left = session.requiredSec - session.trackedSec;
    const unresolved = session.isChargeUnknown;
    const cancelable = session.isCancelable(now);

    function settle(resolve?: ChargeResolution) {
        if (resolve === "not_charged" && !confirm(
            `Beeminderの課金履歴に「${session.title}」の$${session.dollars}が無いことを確かめましたか？`
            + "\nもう一度課金を試みます。",
        )) return;
        void run(async () => {
            const result = await settleNow({ id: session.id, resolve });
            return { text: result.message, kind: result.status === "error" ? "error" : "ok" };
        });
    }

    function cancel() {
        if (!confirm(`「${session.title}」を取り消しますか？\n取り消したセッションは精算せず、課金もしません。`)) return;
        void run(async () => {
            await cancelSession({ id: session.id });
            return { text: `「${session.title}」を取り消しました`, kind: "ok" };
        });
    }

    return (
        <li className={`session ${session.status}`}>
            <div className="session-head">
                <span className="title">{session.title}</span>
                <span className={`badge ${status}`}>{STATUS_LABELS[status]}</span>
            </div>
            <div className="deadline muted">
                {/* カウント開始を指定したセッションだけ出す */}
                {hasCustomStart(session) ? `${formatDeadline(session.startAt, now)}〜` : ""}
                {`締切 ${formatDeadline(session.due, now)}`}
                {session.status === "active" && remainingTime > 0 ? `（残り${formatDuration(remainingTime / 1000)}）` : ""}
                {` ・ $${session.dollars} ・ ${targetLabel(session)}`}
            </div>
            <div className="bar"><div className="fill" style={{ width: `${progressRatio(session) * 100}%` }} /></div>
            <div className="session-foot">
                <span className="amount">{progressLabel(session)}</span>
                {/* 「あと0分」と出ないよう、残りは分単位で切り上げる */}
                <span>{left > 0 ? `あと${formatDuration(Math.ceil(left / 60) * 60)}` : "達成"}</span>
            </div>
            {cancelable && (
                <div className="auto-check">{`${formatDeadline(session.cancelableUntil!, now)}まで取り消せます`}</div>
            )}
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
                {cancelable && (
                    <button type="button" className="link" onClick={cancel} disabled={busy}>取り消す</button>
                )}
                {session.isSettled && (
                    <button type="button" className="link" onClick={() => run(() => deleteSession(session.id))} disabled={busy}>
                        一覧から消す
                    </button>
                )}
            </div>
        </li>
    );
}
