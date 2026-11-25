"use client";

import { deleteSchedule } from "@/lib/account";
import { formatDay, formatDeadline, formatDuration, sessionTitle } from "@/functions/src/format";
import { dateLabel } from "@/functions/src/calendar";
import type { Schedule } from "@/functions/src/schedule";
import { timeRangeLabel } from "@/functions/src/scheduleView";
import { cancelLabel } from "@/functions/src/cancel";
import { targetLabel } from "@/functions/src/format";
import { type ItemProps } from "@/components/session/types";
import { useActivity } from "@/components/session/activity";

// 先の回をいくつ見せるか
const UPCOMING = 3;

/**
 * スケジュール 1 件と、これからの回。
 * 各回のセッションは取り消せる期限の 1 日前に作られ、「セッション」タブから取り消せる。
 */
export default function ScheduleItem({ item: schedule, now }: ItemProps<Schedule>) {
    const { busy, run } = useActivity();
    const occurrences = schedule.upcoming(now, UPCOMING);

    function remove() {
        if (!confirm(`スケジュール「${sessionTitle(schedule)}」を消しますか？\nもう作ったセッションは残ります。`)) return;
        void run(() => deleteSchedule(schedule.id));
    }

    return (
        <li className="session schedule">
            <div className="session-head">
                <span className="title">{sessionTitle(schedule)}</span>
                <span className="badge schedule">{schedule.recurrence.label}</span>
            </div>
            <div className="deadline muted">
                {`${timeRangeLabel(schedule)} ・ $${schedule.dollars} ・ ${targetLabel(schedule)}`}
            </div>
            {schedule.message && <div className="auto-check">{schedule.message}</div>}
            <ul className="occurrences">
                {occurrences.map((o) => {
                    const day = formatDay(o.startAt, now);
                    return (
                        <li key={o.date}>
                            <span>
                                {day === "今日" || day === "明日" ? `${day} ` : ""}{dateLabel(o.date)}
                                <span className="muted">{` あと${formatDuration((o.startAt - now) / 1000)}で開始`}</span>
                            </span>
                            <span className="muted">
                                {schedule.isCreated(o) ? "作成済み" : `${formatDeadline(schedule.creationTime(o), now)}に作成`}
                            </span>
                        </li>
                    );
                })}
            </ul>
            {occurrences.length === 0 && <p className="muted">これからの回はありません</p>}
            <div className="session-foot">
                <span className="updated muted">{`${cancelLabel(schedule.cancelMinutes)}（「セッション」タブから）`}</span>
                <button type="button" className="link" onClick={remove} disabled={busy}>スケジュールを消す</button>
            </div>
        </li>
    );
}
