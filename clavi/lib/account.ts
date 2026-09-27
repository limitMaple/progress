"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { DEFAULT_SETTINGS, type Session, type Settings } from "@/functions/src/model";

/** ログイン中のユーザー。確認中は undefined、未ログインは null。 */
export function useUser() {
    const [user, setUser] = useState<User | null | undefined>(undefined);
    useEffect(() => onAuthStateChanged(auth, setUser), []);
    return user;
}

/** 設定。読み込み中は null。 */
export function useSettings(uid: string) {
    const [settings, setSettings] = useState<Settings | null>(null);
    useEffect(() => onSnapshot(doc(db, "users", uid), (snap) => {
        setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as Partial<Settings> | undefined) });
    }), [uid]);
    return settings;
}

/** セッション一覧（新しい順）。自動精算の結果もそのまま反映される。 */
export function useSessions(uid: string) {
    const [sessions, setSessions] = useState<Session[]>([]);
    useEffect(() => onSnapshot(
        query(collection(db, "users", uid, "sessions"), orderBy("createdAt", "desc")),
        (snap) => setSessions(snap.docs.map((d) => d.data() as Session)),
    ), [uid]);
    return sessions;
}
