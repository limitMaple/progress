"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { saveSettings } from "@/lib/firebase";
import { useSettings } from "@/lib/account";
import type { SaveSettingsResponse } from "@/functions/src/model";

export default function SettingsForm({ uid }: { uid: string }) {
    const settings = useSettings(uid);
    const [togglToken, setTogglToken] = useState("");
    const [beeminderToken, setBeeminderToken] = useState("");
    const [dollars, setDollars] = useState("");
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<SaveSettingsResponse | null>(null);

    // 保存済みの値は最初の 1 回だけ入れる（保存後の更新で入力中の値を消さないため）
    const loaded = settings !== null;
    useEffect(() => {
        if (!settings) return;
        setDollars(String(settings.defaultDollars));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loaded]);

    async function save(event: FormEvent) {
        event.preventDefault();
        setBusy(true);
        setStatus(null);
        try {
            setStatus(await saveSettings({
                togglToken: togglToken.trim(),
                beeminderToken: beeminderToken.trim(),
                defaultDollars: Math.max(1, Math.floor(Number(dollars) || 10)),
            }));
            setTogglToken("");
            setBeeminderToken("");
        } catch (err) {
            setStatus({ ok: false, message: (err as Error).message });
        } finally {
            setBusy(false);
        }
    }

    const tokenPlaceholder = (saved?: boolean) => (saved ? "設定済み（変えるときだけ入力）" : "未設定");

    return (
        <main className="settings">
            <header className="app-header">
                <h1>設定</h1>
                <Link href="/">← 戻る</Link>
            </header>

            <form onSubmit={save}>
                <label>
                    <span>Toggl APIトークン</span>
                    <input
                        type="password" autoComplete="off" spellCheck={false}
                        placeholder={tokenPlaceholder(settings?.hasTogglToken)}
                        value={togglToken} onChange={(e) => setTogglToken(e.target.value)}
                    />
                    <small className="muted">
                        <a href="https://track.toggl.com/profile" target="_blank" rel="noopener">Togglのプロフィール</a>
                        の「API Token」からコピーします。保存するとプロジェクトとタグの一覧を取り直します
                        （Togglで増やしたときは、トークンを空欄のまま保存してください）。
                    </small>
                </label>

                <label>
                    <span>Beeminder APIトークン</span>
                    <input
                        type="password" autoComplete="off" spellCheck={false}
                        placeholder={tokenPlaceholder(settings?.hasBeeminderToken)}
                        value={beeminderToken} onChange={(e) => setBeeminderToken(e.target.value)}
                    />
                    <small className="muted">
                        Beeminderにログインした状態で{" "}
                        <a href="https://www.beeminder.com/api/v1/auth_token.json" target="_blank" rel="noopener">
                            auth_token.json
                        </a>
                        {" "}を開くと出てきます。
                        {settings?.beeminderUser && `（現在: ${settings.beeminderUser}）`}
                    </small>
                </label>

                <label>
                    <span>金額の初期値（$）</span>
                    <input
                        type="number" min="1" step="1" className="num"
                        value={dollars} onChange={(e) => setDollars(e.target.value)}
                    />
                </label>

                <div className="buttons">
                    <button type="submit" className="primary" disabled={busy || !loaded}>
                        {busy ? "確認中…" : "保存して接続を確認"}
                    </button>
                </div>
            </form>

            {status && <p className={`notice ${status.ok ? "ok" : "error"}`}>{status.message}</p>}

            <section className="note">
                <h2>課金のしくみ</h2>
                <p>
                    締切の30秒後に、サーバーが Toggl の記録を数え直します。作業時間に届いていなければ、
                    賭けた額が Beeminder の課金API（<code>POST /charges</code>）で請求されます。
                    Beeminderの目標とは関係なく、この金額だけが課金されます。
                    PCやブラウザを閉じていても実行されます。
                </p>
                <p>
                    トークンは Firestore に保存され、Cloud Functions からしか読めません（画面からも読み出せません）。
                    ただし暗号化はしていません。このトークンがあれば誰でもあなたに課金できるので、扱いに注意してください。
                </p>
            </section>
        </main>
    );
}
