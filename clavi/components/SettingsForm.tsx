"use client";

import { useState, type FormEvent } from "react";
import { auth, saveSettings } from "@/lib/firebase";
import { useSessions, useSettings } from "@/lib/account";
import { cancelLabel, isCancelMinutes, MAX_CANCEL_MINUTES } from "@/functions/src/cancel";
import type { SaveSettingsResponse } from "@/functions/src/requests";
import type { Settings } from "@/functions/src/model";

/**
 * 設定の画面。
 * 精算が済んでいないセッションがある間は、約束の条件になる設定（APIトークンと取り消し猶予）を変えられない。
 * Functions も同じ判定で断るので、ここでの止め方は「押せないようにして理由を見せる」ためのもの。
 */
export default function SettingsForm() {
    const uid = auth.currentUser!.uid;
    const settings = useSettings(uid);
    const sessions = useSessions(uid);
    const locked = sessions.some((s) => !s.isSettled);

    // 取り消し猶予の初めの値に設定を使うので、読み込むまで入力欄は描かない
    if (!settings) return <p className="muted">読み込み中…</p>;

    return <Form settings={settings} locked={locked} />;
}

/** 設定の入力欄。トークンは画面から読めないので、入力欄はいつも空から始める。 */
function Form({ settings, locked }: { settings: Settings; locked: boolean }) {
    const [togglToken, setTogglToken] = useState("");
    const [beeminderToken, setBeeminderToken] = useState("");
    const [cancelMinutes, setCancelMinutes] = useState(String(settings.cancelMinutes));
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<SaveSettingsResponse | null>(null);

    const minutes = Number(cancelMinutes);
    const error = cancelMinutes.trim() === "" || !isCancelMinutes(minutes)
        ? `取り消し猶予は、0以上${MAX_CANCEL_MINUTES}以下の分で入力してください`
        : "";

    async function save(event: FormEvent) {
        event.preventDefault();
        if (error) return;
        setBusy(true);
        try {
            setStatus(await saveSettings({
                togglToken: togglToken.trim(),
                beeminderToken: beeminderToken.trim(),
                // ロック中は変えられないので送らない（送らなければ変更しない）
                cancelMinutes: locked ? null : minutes,
            }));
            setTogglToken("");
            setBeeminderToken("");
        } catch (err) {
            setStatus({ ok: false, message: (err as Error).message });
        } finally {
            setBusy(false);
        }
    }

    const tokenPlaceholder = (saved: boolean) => (saved ? "設定済み（変えるときだけ入力）" : "未設定");

    return (
        <main className="settings">
            <h2>設定</h2>

            {locked && (
                <p className="notice">
                    進行中か精算待ちのセッションがあるので、APIトークンと取り消し猶予は変えられません。
                    これらを変えると走っている約束から逃げられるため、すべて精算されるまで待ってください。
                    プロジェクトとタグの取り直しは、このままでもできます。
                </p>
            )}

            <form onSubmit={save}>
                <label>
                    <span>Toggl APIトークン</span>
                    <input
                        type="password" autoComplete="off" spellCheck={false} disabled={locked}
                        placeholder={tokenPlaceholder(settings.hasTogglToken)}
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
                        type="password" autoComplete="off" spellCheck={false} disabled={locked}
                        placeholder={tokenPlaceholder(settings.hasBeeminderToken)}
                        value={beeminderToken} onChange={(e) => setBeeminderToken(e.target.value)}
                    />
                    <small className="muted">
                        Beeminderにログインした状態で{" "}
                        <a href="https://www.beeminder.com/api/v1/auth_token.json" target="_blank" rel="noopener">
                            auth_token.json
                        </a>
                        {" "}を開くと出てきます。
                        {settings.beeminderUser && `（現在: ${settings.beeminderUser}）`}
                    </small>
                </label>

                <label>
                    <span>取り消し猶予</span>
                    <span className="row">
                        カウント開始の
                        <input
                            type="number" min="0" max={MAX_CANCEL_MINUTES} step="5" className="num" disabled={locked}
                            value={cancelMinutes} onChange={(e) => setCancelMinutes(e.target.value)}
                        />分前まで
                    </span>
                    <small className={error ? "error" : "muted"}>
                        {error || `スケジュールの各回のセッションは、${cancelLabel(minutes)}。休みたい回は、その期限までに取り消します。`}
                    </small>
                </label>

                <div className="buttons">
                    <button type="submit" className="primary" disabled={busy || Boolean(error)}>
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
