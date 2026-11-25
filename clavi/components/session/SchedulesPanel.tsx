"use client";

import type { PanelProps } from "@/components/session/common";
import NewScheduleForm from "@/components/session/NewScheduleForm";
import ScheduleItem from "@/components/session/ScheduleItem";

/** 「スケジュール」タブ。スケジュールの一覧（これからの回も出す）と、新しいスケジュールの入力欄。 */
export default function SchedulesPanel({ uid, settings, schedules, now, setBusy, setMessage, disabled }: PanelProps) {
    return (
        <>
            <section>
                <h2>一覧</h2>
                <ul className="session-list">
                    {schedules.map((schedule) => (
                        <ScheduleItem
                            key={schedule.id}
                            uid={uid}
                            schedule={schedule}
                            now={now}
                            setMessage={setMessage}
                        />
                    ))}
                </ul>
                {schedules.length === 0 && <p className="muted">スケジュールはまだありません</p>}
            </section>

            <NewScheduleForm
                initialRequiredSec={settings.lastRequiredSec}
                projects={settings.projects}
                tags={settings.tags}
                disabled={disabled}
                setBusy={setBusy}
                setMessage={setMessage}
            />
        </>
    );
}
