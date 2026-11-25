import { useEffect, useState } from "react";
import type { Settings } from "@/functions/src/model";
import type { Session } from "@/functions/src/session";
import type { Schedule } from "@/functions/src/schedule";

export type Message = { text: string; kind: "" | "ok" | "error" };

/** 30 秒ごとに再描画して、残り時間の表示を進める（API は呼ばない）。 */
export function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30 * 1000);
        return () => clearInterval(id);
    }, []);
    return now;
}

/** 何の記録を数えるか。「プロジェクト「資格」・タグ「過去問」」「すべての記録」の形。 */
export function targetLabel({ projectName, tag }: { projectName?: string; tag: string }): string {
    const parts = [
        projectName ? `プロジェクト「${projectName}」` : "",
        tag ? `タグ「${tag}」` : "",
    ].filter(Boolean);
    return parts.length ? parts.join("・") : "すべての記録";
}

/**
 * タブ 1 枚に渡すもの。どのタブも同じものを受け取るので、タブを足しても渡す側は変わらない。
 * 設定の読み込みが済んでからしか描かないので、settings は null でない。
 */
export type PanelProps = {
    uid: string;
    settings: Settings;
    /** 新しい順 */
    sessions: Session[];
    /** 古い順 */
    schedules: Schedule[];
    now: number;
    setBusy: (busy: boolean) => void;
    setMessage: (message: Message) => void;
    /** 何かの処理中か、APIトークンが未設定。入力や操作を止める */
    disabled: boolean;
};
