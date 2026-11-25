import { useEffect, useState } from "react";

/** 30 秒ごとに再描画して、残り時間の表示を進める（API は呼ばない）。 */
export function useNow() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30 * 1000);
        return () => clearInterval(id);
    }, []);
    return now;
}
