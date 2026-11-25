"use client";

import type { TabProps } from "@/components/session/types";
import ItemList from "@/components/session/ItemList";
import NewScheduleForm from "@/components/session/NewScheduleForm";
import ScheduleItem from "@/components/session/ScheduleItem";

/** 「スケジュール」タブ。スケジュールの一覧と、新しいスケジュールの入力欄。 */
export default function SchedulesTab({ data: { settings, schedules }, now, canCommit }: TabProps) {
    return (
        <>
            <ItemList
                items={schedules}
                empty="スケジュールはまだありません"
                renderItem={(schedule) => <ScheduleItem item={schedule} now={now} />}
            />
            <NewScheduleForm settings={settings} now={now} canCommit={canCommit} />
        </>
    );
}
