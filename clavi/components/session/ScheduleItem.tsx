"use client";

import { deleteDoc, doc } from "firebase/firestore";
import { db, skipSchedule } from "@/lib/firebase";
import { formatDay, formatDuration, sessionTitle } from "@/functions/src/progress";
import { dateLabel, timeRangeLabel, upcoming, weekdaysLabel } from "@/functions/src/schedule";
import type { ScheduleData } from "@/functions/src/model";
import { targetLabel, type Message } from "@/components/session/common";

// 先の回をいくつ見せるか（休めるのはこの中から）
const UPCOMING = 3;

/** スケジュール 1 件と、これからの回。カウント開始前の回は、その回だけ休める。 */
export default function ScheduleItem({ uid, schedule, now, busy, setBusy, setMessage }: {
    uid: string;
    schedule: ScheduleData;
    now: number;
    busy: boolean;
    setBusy: (busy: boolean) => void;
    setMessage: (message: Message) => void;
}) {
    const occurrences = upcoming(schedule, now, UPCOMING);

    async function skip(date: string, skip: boolean) {
        if (busy) return;
        setBusy(true);
        setMessage({ text: "", kind: "" });
        try {
            await skipSchedule({ id: schedule.id, date, skip });
            setMessage({ text: `${dateLabel(date)}の回を${skip ? "休みにしました" : "休まないことにしました"}`, kind: "ok" });
        } catch (err) {
            setMessage({ text: (err as Error).message, kind: "error" });
        } finally {
            setBusy(false);
        }
    }

    async function remove() {
        if (!confirm(`スケジュール「${sessionTitle(schedule)}」を消しますか？\nもう始まっているセッションは残ります。`)) return;
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
                <span className="badge schedule">{weekdaysLabel(schedule.weekdays)}</span>
            </div>
            <div className="deadline muted">
                {`${timeRangeLabel(schedule)} ・ $${schedule.dollars} ・ ${targetLabel(schedule)}`}
            </div>
            {schedule.message && <div className="auto-check">{schedule.message}</div>}
            <ul className="occurrences">
                {occurrences.map((o) => {
                    const skipped = schedule.skipDates.includes(o.date);
                    const day = formatDay(o.startAt, now);
                    return (
                        <li key={o.date} className={skipped ? "skipped" : ""}>
                            <span>
                                {day === "今日" || day === "明日" ? `${day} ` : ""}{dateLabel(o.date)}
                                <span className="muted">
                                    {skipped ? " 休み" : ` あと${formatDuration((o.startAt - now) / 1000)}で開始`}
                                </span>
                            </span>
                            <button type="button" className="link" onClick={() => skip(o.date, !skipped)} disabled={busy}>
                                {skipped ? "休みをやめる" : "この回を休む"}
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div className="session-foot">
                <span className="updated muted">カウント開始の時刻にセッションが始まります</span>
                <button type="button" className="link" onClick={remove}>スケジュールを消す</button>
            </div>
        </li>
    );
}
