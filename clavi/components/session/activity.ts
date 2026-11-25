"use client";

import { createContext, useContext, useMemo, useRef, useState } from "react";

// 画面の操作（開始・取り消し・精算・消す など）の「処理中」と「知らせ」。
// どの部品も同じ形（処理中なら押せない → 走らせる → 結果を知らせる）なので、ここにまとめる。
// 持つのは Home（useActivityState）で、部品は useActivity で受け取る（props で回さない）。

export type Message = { text: string; kind: "" | "ok" | "error" };

const NO_MESSAGE: Message = { text: "", kind: "" };

export interface Activity {
    /** 何かの操作の途中。ほかの操作を押せなくする */
    busy: boolean;
    /**
     * task を走らせる。走っている間は busy になり、ほかの操作は何もしない。
     * task が返した知らせを出す（返さなければ出さない）。例外ならその文を誤りとして出す。
     */
    run(task: () => Promise<Message | void>): Promise<void>;
    /** 操作を走らせずに知らせだけ出す。NO_MESSAGE なら消す */
    notify(message: Message): void;
}

const ActivityContext = createContext<Activity | null>(null);

export const ActivityProvider = ActivityContext.Provider;

/** 部品から、Home が持つ Activity を使う。 */
export function useActivity(): Activity {
    const activity = useContext(ActivityContext);
    if (!activity) throw new Error("ActivityProvider の中で使ってください");
    return activity;
}

/** Activity と、いま出している知らせを持つ（Home が 1 つだけ持つ）。 */
export function useActivityState(): { activity: Activity; message: Message; clearMessage: () => void } {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<Message>(NO_MESSAGE);
    // 同じ描画の中で 2 回押されても 1 回だけ走らせるよう、state とは別に持つ
    const running = useRef(false);

    const activity = useMemo<Activity>(() => ({
        busy,
        notify: setMessage,
        async run(task) {
            if (running.current) return;
            running.current = true;
            setBusy(true);
            setMessage(NO_MESSAGE);
            try {
                const result = await task();
                if (result) setMessage(result);
            } catch (err) {
                setMessage({ text: (err as Error).message, kind: "error" });
            } finally {
                running.current = false;
                setBusy(false);
            }
        },
    }), [busy]);

    return { activity, message, clearMessage: () => setMessage(NO_MESSAGE) };
}
