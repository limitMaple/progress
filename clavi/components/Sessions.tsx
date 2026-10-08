"use client";

import { useState } from "react";
import Link from "next/link";
import { auth, syncNow } from "@/lib/firebase";
import { useSessions, useSettings } from "@/lib/account";
import { useNow, type Message } from "@/components/session/common";
import NewSessionForm from "@/components/session/NewSessionForm";
import SessionItem from "@/components/session/SessionItem";

export default function Sessions() {
    const uid = auth.currentUser!.uid;
    const settings = useSettings(uid);
    const sessions = useSessions(uid);
    const now = useNow();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<Message>({ text: "", kind: "" });

    const hasTokens = Boolean(settings?.hasTogglToken && settings?.hasBeeminderToken);

    async function refresh() {
        if (busy) return;
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
        <main>
            {settings && !hasTokens && (
                <p className="notice">
                    APIトークンが未設定です。<Link href="/settings">設定を開く</Link>
                </p>
            )}
            {message.text && <p className={`notice ${message.kind}`}>{message.text}</p>}

            <section>
                <div className="section-head">
                    <h2>セッション</h2>
                    <button type="button" onClick={refresh} disabled={busy || !hasTokens}>↻ 更新</button>
                </div>
                <ul className="session-list">
                    {sessions.map((session) => (
                        <SessionItem
                            key={session.id}
                            uid={uid}
                            session={session}
                            now={now}
                            busy={busy}
                            setBusy={setBusy}
                            setMessage={setMessage}
                        />
                    ))}
                </ul>
                {sessions.length === 0 && <p className="muted">セッションはまだありません</p>}
            </section>

            {settings && (
                <NewSessionForm
                    initialRequiredSec={settings.lastRequiredSec}
                    projects={settings.projects}
                    tags={settings.tags}
                    disabled={busy || !hasTokens}
                    setBusy={setBusy}
                    setMessage={setMessage}
                />
            )}
        </main>
    );
}
