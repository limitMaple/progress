"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { useSchedules, useSessions, useSettings } from "@/lib/account";
import { useNow } from "@/components/session/useNow";
import { type AccountData, type TabProps } from "@/components/session/types";
import { ActivityProvider, useActivityState } from "@/components/session/activity";
import SchedulesTab from "@/components/session/SchedulesTab";
import SessionsTab from "@/components/session/SessionsTab";

// ログイン後の画面。Home はデータを読み、操作の処理中と知らせ（Activity）を持ち、タブを切り替えるだけ。
// タブの中身は各タブの部品が描く。タブを足すときは、TabProps を受け取る部品を書いて TABS に 1 つ足す。

/** タブ 1 枚。 */
interface Tab {
    label: string;
    /** タブに出す、いま抱えているものの数。0 なら出さない */
    count(data: AccountData): number;
    Content(props: TabProps): ReactNode;
}

const TABS = {
    sessions: {
        label: "セッション",
        // まだ終わっていない（進行中・要確認の）セッションの数
        count: ({ sessions }) => sessions.filter((s) => !s.isSettled).length,
        Content: SessionsTab,
    },
    schedules: {
        label: "スケジュール",
        count: ({ schedules }) => schedules.length,
        Content: SchedulesTab,
    },
} satisfies Record<string, Tab>;

type TabKey = keyof typeof TABS;

const TAB_KEYS = Object.keys(TABS) as TabKey[];

/**
 * どのタブも描いたままにして（開いていない方は hidden）、タブを行き来しても入力中の値が消えないようにする。
 * 入力欄の初めの値に設定を使うので、設定を読み込むまでタブの中身は描かない。
 */
export default function Home() {
    const uid = auth.currentUser!.uid;
    const settings = useSettings(uid);
    const sessions = useSessions(uid);
    const schedules = useSchedules(uid);
    const now = useNow();
    const { activity, message, clearMessage } = useActivityState();
    const [tab, setTab] = useState<TabKey>("sessions");

    const data: AccountData | null = settings && { settings, sessions, schedules };
    const canCommit = Boolean(settings?.hasTogglToken && settings?.hasBeeminderToken);

    function select(key: TabKey) {
        setTab(key);
        // 前のタブでの知らせは、そのタブでの話なので消す
        clearMessage();
    }

    /** タブは左右キーでも選べるようにする（role="tab" の決まり）。 */
    function moveSelection(event: KeyboardEvent<HTMLDivElement>) {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = TAB_KEYS[(TAB_KEYS.indexOf(tab) + step + TAB_KEYS.length) % TAB_KEYS.length];
        select(next);
        document.getElementById(`tab-${next}`)?.focus();
    }

    return (
        <main>
            {settings && !canCommit && (
                <p className="notice">
                    APIトークンが未設定です。<Link href="/settings">設定を開く</Link>
                </p>
            )}
            {message.text && <p className={`notice ${message.kind}`}>{message.text}</p>}

            <div className="tabs" role="tablist" aria-label="画面" onKeyDown={moveSelection}>
                {TAB_KEYS.map((key) => {
                    const selected = key === tab;
                    const count = data ? TABS[key].count(data) : 0;
                    return (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            id={`tab-${key}`}
                            className={`tab ${selected ? "on" : ""}`}
                            aria-selected={selected}
                            aria-controls={`panel-${key}`}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => select(key)}
                        >
                            {TABS[key].label}
                            {count > 0 && <span className="count">{count}</span>}
                        </button>
                    );
                })}
            </div>

            <ActivityProvider value={activity}>
                {TAB_KEYS.map((key) => {
                    const { Content } = TABS[key];
                    return (
                        <div key={key} role="tabpanel" id={`panel-${key}`} aria-labelledby={`tab-${key}`} hidden={key !== tab}>
                            {data && <Content data={data} now={now} canCommit={canCommit} />}
                        </div>
                    );
                })}
            </ActivityProvider>
        </main>
    );
}
