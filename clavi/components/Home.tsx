"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { useSchedules, useSessions, useSettings } from "@/lib/account";
import { useNow, type Message, type PanelProps } from "@/components/session/common";
import SessionsPanel from "@/components/session/SessionsPanel";
import SchedulesPanel from "@/components/session/SchedulesPanel";

// 画面はタブで分ける。タブ 1 枚を Tab として持ち、Home はタブの並びと中身を出すだけにする
// （タブによる分岐を書かない）。タブを足すときは、パネルの部品を書いて TABS に足す。
// どのパネルも PanelProps を受け取るので、渡すものは増やさなくてよい。

/** タブ 1 枚。 */
interface Tab {
    label: string;
    /** タブに出す、いま抱えているものの数。0 なら出さない */
    count(props: PanelProps): number;
    Panel(props: PanelProps): ReactNode;
}

const TABS = {
    sessions: {
        label: "セッション",
        // まだ終わっていない（進行中・要確認の）セッションの数
        count: ({ sessions }) => sessions.filter((s) => !s.isSettled).length,
        Panel: SessionsPanel,
    },
    schedules: {
        label: "スケジュール",
        count: ({ schedules }) => schedules.length,
        Panel: SchedulesPanel,
    },
} satisfies Record<string, Tab>;

type TabKey = keyof typeof TABS;

const TAB_KEYS = Object.keys(TABS) as TabKey[];

/**
 * ログイン後の画面。セッションとスケジュールをタブで分ける。
 * どちらのパネルも描いたままにして（開いていない方は hidden）、タブを行き来しても入力中の値が消えないようにする。
 */
export default function Home() {
    const uid = auth.currentUser!.uid;
    const settings = useSettings(uid);
    const sessions = useSessions(uid);
    const schedules = useSchedules(uid);
    const now = useNow();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<Message>({ text: "", kind: "" });
    const [tab, setTab] = useState<TabKey>("sessions");

    const hasTokens = Boolean(settings?.hasTogglToken && settings?.hasBeeminderToken);

    // 入力欄の初期値に設定を使うので、設定を読み込むまでパネルは描かない
    const props: PanelProps | null = settings && {
        uid,
        settings,
        sessions,
        schedules,
        now,
        setBusy,
        setMessage,
        disabled: busy || !hasTokens,
    };

    function select(key: TabKey) {
        setTab(key);
        // 前のタブでの知らせは、そのタブでの話なので消す
        setMessage({ text: "", kind: "" });
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
            {settings && !hasTokens && (
                <p className="notice">
                    APIトークンが未設定です。<Link href="/settings">設定を開く</Link>
                </p>
            )}
            {message.text && <p className={`notice ${message.kind}`}>{message.text}</p>}

            <div className="tabs" role="tablist" aria-label="画面" onKeyDown={moveSelection}>
                {TAB_KEYS.map((key) => {
                    const selected = key === tab;
                    const count = props ? TABS[key].count(props) : 0;
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

            {TAB_KEYS.map((key) => {
                const { Panel } = TABS[key];
                return (
                    <div key={key} role="tabpanel" id={`panel-${key}`} aria-labelledby={`tab-${key}`} hidden={key !== tab}>
                        {props && <Panel {...props} />}
                    </div>
                );
            })}
        </main>
    );
}
