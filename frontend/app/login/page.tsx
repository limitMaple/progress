'use client';

import { useRouter } from 'next/navigation';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { useAuth } from '@/auth/AuthContext';
import { useEffect } from 'react';

export default function LoginPage() {
    const router = useRouter();
    const { user, loading } = useAuth();

    // Googleログイン処理
    const handleGoogleLogin = async () => {
        try {
            await signInWithPopup(auth, googleProvider);
            // ログイン成功後、ダッシュボードにリダイレクト
            router.push('/');
        } catch (error) {
            console.error("Googleログインエラー:", error);
            alert("ログインに失敗しました。");
        }
    };

    // すでにログイン済みの場合はダッシュボードにリダイレクト
    useEffect(() => {
        if (!loading && user) {
            router.push('/');
        }
    }, [user, loading, router]);

    // ローディング中またはログイン済みなら何も表示しない
    if (loading || user) {
        return <p>読み込み中...</p>;
    }

    return (
        <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 200px)'}}>
            <div className="text-center p-10 bg-white dark:bg-gray-800 rounded-lg shadow-xl">
                <h1 className="text-3xl font-bold mb-6">ログイン</h1>
                <button
                    onClick={handleGoogleLogin}
                    className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75"
                >
                    Googleでログイン
                </button>
            </div>
        </div>
    );
}