"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";
import { auth, provider } from "@/lib/firebase";
import { useUser } from "@/lib/account";

// エミュレーターのポップアップは元のページ（window.opener）経由で結果を返すので、
// ポップアップを別タブとして開くブラウザでは「No matching frame」で失敗する。開発時は画面遷移でログインする。
const signIn = process.env.NODE_ENV === "development" ? signInWithRedirect : signInWithPopup;

/**
 * ログインしていなければログイン画面を出し、していれば共通のヘッダー（設定・ログアウト）と中身（ページ）を出す。
 * layout.tsx で全ページを包むので、ログインとログアウトはここだけで扱い、ページ側には書かない。
 * ページはログイン中にしか描かれないので、ユーザーは auth.currentUser! で取ってよい。
 */
export function AuthGate({ children }: { children: ReactNode }) {
    const user = useUser();

    if (user === undefined) return <p className="muted">読み込み中…</p>;
    if (user) {
        return (
            <>
                <header className="app-header">
                    <h1><Link href="/" className="home">Toggl Ratchet</Link></h1>
                    <div className="actions">
                        <Link href="/settings" className="button icon" title="設定">⚙</Link>
                        <button type="button" className="link" onClick={() => signOut(auth)}>ログアウト</button>
                    </div>
                </header>
                {children}
            </>
        );
    }

    return (
        <main className="login">
            <h1>Toggl Ratchet</h1>
            <p className="muted">
                「○○までに△時間やる」と決めて、Toggl の記録で判定します。
                締切までに届かなければ、Beeminder で自分に課金します。
            </p>
            <button type="button" className="primary" onClick={() => signIn(auth, provider)}>
                Googleでログイン
            </button>
        </main>
    );
}
