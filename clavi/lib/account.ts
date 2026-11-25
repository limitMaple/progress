"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
    collection, deleteDoc, doc, onSnapshot, orderBy, query, type DocumentData, type QueryConstraint,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { DEFAULT_SETTINGS, type ScheduleData, type SessionData, type Settings } from "@/functions/src/model";
import { Session } from "@/functions/src/session";
import { Schedule } from "@/functions/src/schedule";

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

/** users/{uid} の下のコレクションを、並べて読み続ける。読み込み中と空は同じ []。 */
function useCollection<T>(uid: string, name: string, order: QueryConstraint, toItem: (data: DocumentData) => T): T[] {
    const [items, setItems] = useState<T[]>([]);
    useEffect(() => onSnapshot(
        query(collection(db, "users", uid, name), order),
        (snap) => setItems(snap.docs.map((d) => toItem(d.data()))),
    ), [uid, name, order, toItem]);
    return items;
}

// useCollection の依存に入るので、描くたびに作り直さないよう外に置く
const NEWEST_FIRST = orderBy("createdAt", "desc");
const OLDEST_FIRST = orderBy("createdAt");
const toSession = (data: DocumentData) => new Session(data as SessionData);
const toSchedule = (data: DocumentData) => new Schedule(data as ScheduleData);

/** セッション一覧（新しい順）。自動精算の結果もそのまま反映される。 */
export function useSessions(uid: string) {
    return useCollection(uid, "sessions", NEWEST_FIRST, toSession);
}

/** スケジュール一覧（古い順）。次の回の変化もそのまま反映される。 */
export function useSchedules(uid: string) {
    return useCollection(uid, "schedules", OLDEST_FIRST, toSchedule);
}

// 画面から直接消せるのはこの 2 つだけ（firestore.rules で許している）。ほかの書き込みは Functions を呼ぶ。
// ページはログイン中にしか描かれないので（AuthGate）、ユーザーは auth.currentUser! で取ってよい。

/** 精算の済んだ（か取り消した）セッションを、一覧から消す。 */
export const deleteSession = (id: string) => deleteDoc(doc(db, "users", auth.currentUser!.uid, "sessions", id));

/** スケジュールを消す。もう作ったセッションは残る。 */
export const deleteSchedule = (id: string) => deleteDoc(doc(db, "users", auth.currentUser!.uid, "schedules", id));
