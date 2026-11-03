"use client";

import { deleteDoc, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatDay, formatDeadline, formatDuration, sessionTitle } from "@/functions/src/progress";
import { dateLabel } from "@/functions/src/calendar";
import type { Schedule } from "@/functions/src/schedule";
import { targetLabel, type Message } from "@/components/session/common";

// 先の回をいくつ見せるか
const UPCOMING = 3;

/**
 * スケジュール 1 件と、これからの回。
 * 各回のセッションは取り消せる期限の 1 日前に作られ、セッションの一覧から取り消せる。
 */
export default function ScheduleItem({ uid, schedule, now, setMessage }: {
    uid: string;
    schedule: Schedule;
    now: number;
    setMessage: (message: Message) => void;
}) {
    const occurrences = schedule.upcoming(now, UPCOMING);

    async function remove() {
        if (!confirm(`スケジュール「${sessionTitle(schedule)}」を消しますか？\nもう作ったセッションは残ります。`)) return;
        try {
            await deleteDoc(doc(db, "users", uid, "schedules", schedule.id));
        } catch (err) {
            setMessage({ text: (err as Error).message, kind: "error" });
        }
    }

    return (
        <li className="session schedule">
            <div className="session-head">
                <span className="title">{sessionTitle(schedule)}</span>
                <span className="badge schedule">{schedule.recurrence.label}</span>
            </div>
            <div className="deadline muted">
                {`${schedule.timeRangeLabel} ・ $${schedule.dollars} ・ ${targetLabel(schedule)}`}
            </div>
            {schedule.message && <div className="auto-check">{schedule.message}</div>}
            <ul className="occurrences">
                {occurrences.map((o) => {
                    const day = formatDay(o.startAt, now);
                    // nextDate より前の回は、もうセッションを作った（か、作らずに過ぎた）
                    const created = !schedule.nextDate || o.date < schedule.nextDate;
                    return (
                        <li key={o.date}>
                            <span>
                                {day === "今日" || day === "明日" ? `${day} ` : ""}{dateLabel(o.date)}
                                <span className="muted">{` あと${formatDuration((o.startAt - now) / 1000)}で開始`}</span>
                            </span>
                            <span className="muted">
                                {created ? "作成済み" : `${formatDeadline(schedule.createAt(o), now)}に作成`}
                            </span>
                        </li>
                    );
                })}
            </ul>
            {occurrences.length === 0 && <p className="muted">これからの回はありません</p>}
            <div className="session-foot">
                <span className="updated muted">{`${schedule.cancelLabel}（セッションの一覧から）`}</span>
                <button type="button" className="link" onClick={remove}>スケジュールを消す</button>
            </div>
        </li>
    );
}
