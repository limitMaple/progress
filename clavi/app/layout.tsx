import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
    title: "Toggl Ratchet",
    description: "「○○までに△時間やる」を TaskRatchet に賭けて、Toggl の記録で達成したら完了にする",
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="ja">
        <body>
        <div className="page">{children}</div>
        </body>
        </html>
    );
}
