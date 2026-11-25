"use client";

import { syncNow } from "@/lib/firebase";
import type { PanelProps } from "@/components/session/common";
import NewSessionForm from "@/components/session/NewSessionForm";
import SessionItem from "@/components/session/SessionItem";

/** 「セッション」タブ。セッションの一覧（休みたい回の取り消しもここ）と、新しいセッションの入力欄。 */
export default function SessionsPanel({ uid, settings, sessions, now, setBusy, setMessage, disabled }: PanelProps) {
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

    return (
        <>
            <section>
                <div className="section-head">
                    <h2>一覧</h2>
                    <button type="button" onClick={refresh} disabled={disabled}>↻ 更新</button>
                </div>
                <ul className="session-list">
                    {sessions.map((session) => (
                        <SessionItem
                            key={session.id}
                            uid={uid}
                            session={session}
                            now={now}
                            busy={disabled}
                            setBusy={setBusy}
                            setMessage={setMessage}
                        />
                    ))}
                </ul>
                {sessions.length === 0 && <p className="muted">セッションはまだありません</p>}
            </section>

            <NewSessionForm
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
