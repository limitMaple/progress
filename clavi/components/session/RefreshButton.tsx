"use client";

import { syncNow } from "@/lib/firebase";
import type { PanelProps } from "@/components/session/common";

/** セッションの一覧の「↻ 更新」。Toggl の記録で進捗を取り直す（達していればその場で達成になる）。 */
export default function RefreshButton({ sessions, setBusy, setMessage, disabled }: PanelProps) {
    async function refresh() {
        if (disabled) return;
        if (!sessions.some((s) => s.status === "active")) {
            setMessage({ text: "進行中のセッションはありません", kind: "" });
            return;
        }
        setBusy(true);
        setMessage({ text: "", kind: "" });
        try {
            const result = await syncNow();
            if (result.done.length) {
                setMessage({ text: `達成しました: ${result.done.join("、")}`, kind: "ok" });
            }
        } catch (err) {
            setMessage({ text: (err as Error).message, kind: "error" });
        } finally {
            setBusy(false);
        }
    }

    return <button type="button" onClick={refresh} disabled={disabled}>↻ 更新</button>;
}
