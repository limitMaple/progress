import "./globals.css";
import type { ReactNode } from "react";
import { AuthGate } from "@/components/AuthGate";

export const metadata = {
    title: "Toggl Ratchet",
    description: "「○○までに△時間やる」と決めて Toggl の記録で判定し、届かなければ Beeminder で自分に課金する",
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="ja">
        <body>
        <div className="page">
            {/* すべてのページはログインが前提。ログインしていなければページの代わりにログイン画面が出る */}
            <AuthGate>{children}</AuthGate>
        </div>
        </body>
        </html>
    );
}
