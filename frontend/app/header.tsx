'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/auth/AuthContext';

export default function Header() {
    const { user, loading } = useAuth();
    const router = useRouter();

    const handleLogout = async () => {
        try {
            await signOut(auth);
            router.push('/login'); // ログアウト後、ログインページにリダイレクト
        } catch (error) {
            console.error("ログアウトエラー:", error);
        }
    };

    return (
        <header className="bg-white dark:bg-gray-800 shadow-md sticky top-0 z-10">
            <nav className="container mx-auto px-6 py-3">
                <div className="flex justify-between items-center">
                    <Link href="/" className="text-xl font-bold text-blue-600 dark:text-blue-400">
                        AI PWA
                    </Link>
                    <div>
                        {loading ? (
                            <div className="w-20 h-8 bg-gray-300 dark:bg-gray-700 rounded animate-pulse"></div>
                        ) : user ? (
                            // ログインしている場合の表示
                            <div className="flex items-center space-x-4">
                                <span className="text-sm">ようこそ, {user.displayName || 'ゲスト'}さん</span>
                                <button
                                    onClick={handleLogout}
                                    className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                                >
                                    ログアウト
                                </button>
                            </div>
                        ) : (
                            // ログインしていない場合の表示
                            <Link href="/login">
                                <button className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600">
                                    ログイン
                                </button>
                            </Link>
                        )}
                    </div>
                </div>
            </nav>
        </header>
    );
}