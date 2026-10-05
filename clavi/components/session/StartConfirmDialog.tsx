"use client";

import { useEffect, useRef } from "react";
import { sessionTitle, formatDuration, formatDay } from "@/functions/src/progress";
import { targetLabel } from "@/components/session/common";
import type { Draft } from "@/components/session/NewSessionForm";

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
export default function StartConfirmDialog({ draft, busy, onBack, onStart }: {
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
