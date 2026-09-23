"use client";

import type { ReactNode } from "react";
import type { User } from "firebase/auth";
import { signInWithPopup, signInWithRedirect } from "firebase/auth";
import { auth, provider } from "@/lib/firebase";
import { useUser } from "@/lib/account";

// エミュレーターのポップアップは元のページ（window.opener）経由で結果を返すので、
// ポップアップを別タブとして開くブラウザでは「No matching frame」で失敗する。開発時は画面遷移でログインする。
const signIn = process.env.NODE_ENV === "development" ? signInWithRedirect : signInWithPopup;

/** ログインしていれば children にユーザーを渡し、していなければログインボタンを出す。 */
export default function SignedIn({ children }: { children: (user: User) => ReactNode }) {
    const user = useUser();

    if (user === undefined) return <p className="muted">読み込み中…</p>;
    if (user) return children(user);

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
