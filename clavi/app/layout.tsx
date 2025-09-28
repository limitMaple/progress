
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/app/globals.css";
import Header from "@/app/header";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "Clavi", // アプリのタイトル
    description: "俺のためのタスク管理ソフト",
};

export default function RootLayout({
                                       children,
                                   }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ja">
        <body className={`${inter.className} bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100`}>
        <div className="flex flex-col min-h-screen">
            {/* ヘッダー */}
            <Header />
            {/* メインコンテンツエリア */}
            <main className="flex-1 container mx-auto p-6">
                {children} {/* ← ここに各ページの内容が表示されます */}
            </main>

            {/* フッター */}
            <footer className="bg-white dark:bg-gray-800 mt-8 py-4">
                <div className="container mx-auto px-6 text-center text-gray-500">
                    <p>© 2024 Your Name. All Rights Reserved.</p>
                </div>
            </footer>
        </div>
        </body>
        </html>
    );
}