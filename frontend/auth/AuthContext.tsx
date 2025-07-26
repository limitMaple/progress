'use client'; // このファイルがクライアントサイドで動作することを明示

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '@/lib/firebase'; // Step 2で作成したファイルをインポート

// Contextで提供する値の型定義
type AuthContextType = {
  user: User | null;
  loading: boolean;
};

// Contextオブジェクトの作成
const AuthContext = createContext<AuthContextType>({ user: null, loading: true });

// アプリ全体に認証情報を提供するプロバイダーコンポーネント
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // onAuthStateChangedは認証状態の変更を監視するリスナー
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    // コンポーネントがアンマウントされる時にリスナーを解除
    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// 簡単にContextの値を取得するためのカスタムフック
export const useAuth = () => useContext(AuthContext);