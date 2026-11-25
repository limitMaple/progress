import { useEffect, useState } from "react";
import type { Settings, TogglProject } from "@/functions/src/model";
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

/** 一覧の 1 件の部品が受け取るもの。使わないものは受け取らなくてよい（ScheduleItem は busy を見ない）。 */
export type ItemProps<T> = {
    uid: string;
    item: T;
    now: number;
    busy: boolean;
    setBusy: (busy: boolean) => void;
    setMessage: (message: Message) => void;
};

/** 「新しい〜」の入力欄が受け取るもの。どのタブの入力欄も同じものを受け取る。 */
export type FormProps = {
    /** 作業時間の初めの値。部品を作るときに 1 回だけ使う（あとで設定が変わっても、入力中の値は上書きしない） */
    initialRequiredSec: number;
    /** 選択肢。設定が変われば追従する */
    projects: TogglProject[];
    tags: string[];
    /** 設定の取り消し猶予（分）。スケジュールの各回をいつまで取り消せるか */
    cancelMinutes: number;
    disabled: boolean;
    setBusy: (busy: boolean) => void;
    setMessage: (message: Message) => void;
};

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
