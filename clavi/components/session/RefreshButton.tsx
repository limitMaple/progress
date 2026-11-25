"use client";

import { syncNow } from "@/lib/firebase";
import type { Session } from "@/functions/src/session";
import { useActivity } from "@/components/session/activity";

/** セッションの一覧の「↻ 更新」。Toggl の記録で進捗を取り直す（達していればその場で達成になる）。 */
export default function RefreshButton({ sessions, disabled }: { sessions: Session[]; disabled: boolean }) {
    const { busy, run, notify } = useActivity();

    function refresh() {
        if (!sessions.some((s) => s.status === "active")) {
            notify({ text: "進行中のセッションはありません", kind: "" });
            return;
        }
        void run(async () => {
            const { done } = await syncNow();
            if (done.length) return { text: `達成しました: ${done.join("、")}`, kind: "ok" };
        });
    }

    return <button type="button" onClick={refresh} disabled={busy || disabled}>↻ 更新</button>;
}
