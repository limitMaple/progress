"use client";

import { useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { useSchedules, useSessions, useSettings } from "@/lib/account";
import type { Schedule } from "@/functions/src/schedule";
import type { Session } from "@/functions/src/session";
import { useNow, type FormProps, type ItemProps, type Message, type PanelProps } from "@/components/session/common";
import NewScheduleForm from "@/components/session/NewScheduleForm";
import NewSessionForm from "@/components/session/NewSessionForm";
import RefreshButton from "@/components/session/RefreshButton";
import ScheduleItem from "@/components/session/ScheduleItem";
import SessionItem from "@/components/session/SessionItem";

// 画面はタブで分ける。どのタブも「一覧」と「新しい〜」でできているので、中身は Panel が描き、
// タブごとに違うところだけを Tab として TABS に持つ（タブによる分岐を書かない）。
// タブを足すときは、一覧の 1 件の部品と入力欄の部品を書いて、TABS に 1 つ足す。

/** 一覧に出せるもの。Session も Schedule も id で見分ける。 */
interface Listed {
    id: string;
}

/** タブ 1 枚。 */
interface Tab<T extends Listed> {
    label: string;
    /** 一覧に出すもの */
    items(props: PanelProps): T[];
    /** タブに出す、いま抱えているものの数。0 なら出さない */
    count(items: T[]): number;
    /** 一覧の 1 件 */
    Item(props: ItemProps<T>): ReactNode;
    /** 一覧が空のときの文 */
    empty: string;
    /** 見出しの右に置くボタン。無ければ null */
    Action: ((props: PanelProps) => ReactNode) | null;
    /** 「新しい〜」の入力欄 */
    Form(props: FormProps): ReactNode;
}

const TABS = {
    sessions: {
        label: "セッション",
        items: ({ sessions }) => sessions,
        // まだ終わっていない（進行中・要確認の）セッションの数
        count: (sessions) => sessions.filter((s) => !s.isSettled).length,
        Item: SessionItem,
        empty: "セッションはまだありません",
        Action: RefreshButton,
        Form: NewSessionForm,
    } satisfies Tab<Session>,
    schedules: {
        label: "スケジュール",
        items: ({ schedules }) => schedules,
        count: (schedules) => schedules.length,
        Item: ScheduleItem,
        empty: "スケジュールはまだありません",
        Action: null,
        Form: NewScheduleForm,
    } satisfies Tab<Schedule>,
};

type TabKey = keyof typeof TABS;

const TAB_KEYS = Object.keys(TABS) as TabKey[];

/** そのタブ。中身の型（Session か Schedule か）は TABS の中でだけ見るので、ここでは Listed として扱う。 */
const tabOf = (key: TabKey) => TABS[key] as unknown as Tab<Listed>;

/** タブ 1 枚の中身。一覧と「新しい〜」の入力欄を出す。 */
function Panel({ tab, panel }: { tab: Tab<Listed>; panel: PanelProps }) {
    const { uid, settings, now, setBusy, setMessage, disabled } = panel;
    const items = tab.items(panel);

    return (
        <>
            <section>
                <div className="section-head">
                    <h2>一覧</h2>
                    {tab.Action && <tab.Action {...panel} />}
                </div>
                <ul className="session-list">
                    {items.map((item) => (
                        <tab.Item
                            key={item.id}
                            uid={uid}
                            item={item}
                            now={now}
                            busy={disabled}
                            setBusy={setBusy}
                            setMessage={setMessage}
                        />
                    ))}
                </ul>
                {items.length === 0 && <p className="muted">{tab.empty}</p>}
            </section>

            <tab.Form
                initialRequiredSec={settings.lastRequiredSec}
                projects={settings.projects}
                tags={settings.tags}
                cancelMinutes={settings.cancelMinutes}
                disabled={disabled}
                setBusy={setBusy}
                setMessage={setMessage}
            />
        </>
    );
}

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

    // 入力欄の初めの値に設定を使うので、設定を読み込むまでパネルは描かない
    const panel: PanelProps | null = settings && {
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
                    const count = panel ? tabOf(key).count(tabOf(key).items(panel)) : 0;
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

            {TAB_KEYS.map((key) => (
                <div key={key} role="tabpanel" id={`panel-${key}`} aria-labelledby={`tab-${key}`} hidden={key !== tab}>
                    {panel && <Panel tab={tabOf(key)} panel={panel} />}
                </div>
            ))}
        </main>
    );
}
