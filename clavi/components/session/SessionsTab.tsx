"use client";

import type { TabProps } from "@/components/session/types";
import ItemList from "@/components/session/ItemList";
import NewSessionForm from "@/components/session/NewSessionForm";
import RefreshButton from "@/components/session/RefreshButton";
import SessionItem from "@/components/session/SessionItem";

/** 「セッション」タブ。セッションの一覧（↻ 更新つき）と、新しいセッションの入力欄。 */
export default function SessionsTab({ data: { settings, sessions }, now, canCommit }: TabProps) {
    return (
        <>
            <ItemList
                items={sessions}
                empty="セッションはまだありません"
                action={<RefreshButton sessions={sessions} disabled={!canCommit} />}
                renderItem={(session) => <SessionItem item={session} now={now} />}
            />
            <NewSessionForm settings={settings} now={now} canCommit={canCommit} />
        </>
    );
}
