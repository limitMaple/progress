// app/layout.tsx
import "./globals.css"
import { Inter } from "next/font/google"
import { ReactNode } from "react"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
    title: "Task Manager",
    description: "Task management app with Firebase and Google Auth",
}

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="ja">
        <body className={`${inter.className} bg-gray-100 min-h-screen`}>
        <div className="flex flex-col min-h-screen">
            <header className="bg-white shadow p-4 flex justify-between items-center">
                <h1 className="text-xl font-bold">Task Manager</h1>
                {/* Googleログイン/ログアウトボタンはここに配置予定 */}
            </header>
            <main className="flex-1 p-4">{children}</main>
            <footer className="bg-gray-200 text-center text-sm p-2">
                © 2025 Task Manager
            </footer>
        </div>
        </body>
        </html>
    )
}
