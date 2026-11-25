// 画面の部品どうしで受け渡す props の形。

import type { Settings } from "@/functions/src/model";
import type { Schedule } from "@/functions/src/schedule";
import type { Session } from "@/functions/src/session";

/** 読み込んだアカウントのデータ。Home が読み、タブはここから自分の要るものだけを使う。 */
export type AccountData = {
    settings: Settings;
    /** 新しい順 */
    sessions: Session[];
    /** 古い順 */
    schedules: Schedule[];
};

/** タブ 1 枚の中身が受け取るもの。 */
export type TabProps = {
    data: AccountData;
    now: number;
    /** APIトークンが揃っていて、約束を作れるか */
    canCommit: boolean;
};

/** 一覧の 1 件の部品が受け取るもの。操作の処理中と知らせは useActivity から取る。 */
export type ItemProps<T> = {
    item: T;
    now: number;
};

/** 「新しい〜」の入力欄が受け取るもの。操作の処理中と知らせは useActivity から取る。 */
export type FormProps = {
    /** 選択肢（プロジェクト・タグ）と取り消し猶予。作業時間の初めの値（lastRequiredSec）は、部品を作るときに 1 回だけ使う */
    settings: Settings;
    /** 表示に使う今の時刻（30 秒ごとに進む）。送るときは Date.now() で確かめ直す */
    now: number;
    /** APIトークンが揃っていて、約束を作れるか */
    canCommit: boolean;
};
