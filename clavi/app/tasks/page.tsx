"use client";

import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import {collection, getDocs, updateDoc, doc, deleteDoc} from "firebase/firestore";
import { db, app } from "@/lib/firebase";
import {onAuthStateChanged} from "@firebase/auth";

type Task = { id: string; name: string; done: boolean };

export default function TasksPage() {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [viewDone, setViewDone] = useState<boolean>(false);
    const auth = getAuth(app);

    const fetchTasks = async () => {
        if (!auth.currentUser?.uid) return;
        const q = collection(db, "users", auth.currentUser.uid, "tasks");
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
        })) as Task[];
        setTasks(data);
    };

    // 認証状態を監視してuidを更新
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            fetchTasks();
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        fetchTasks();
    }, [auth.currentUser]);

    const toggleTask = async (id: string, done: boolean) => {
        if (!auth.currentUser) return;
        const ref = doc(db, "users", auth.currentUser.uid, "tasks", id);
        await updateDoc(ref, { done: !done });
        setTasks((prev) =>
            prev.map((t) => (t.id === id ? { ...t, done: !done } : t))
        );
    };

    const deleteTask = async (id: string) => {
        if (!auth.currentUser) return;
        const ref = doc(db, "users", auth.currentUser.uid, "tasks", id);
        await deleteDoc(ref);
        fetchTasks()
    };

    return (
        <main>
            <nav className="nav" role="navigation">
                <h1>タスク一覧</h1>
                <b>{auth.currentUser?.uid == null ? "認証待機中" : ""}</b>
                <ul>
                    {tasks.map(task => (
                        <div key={task.id} className="card task" style={{marginBottom: '10px'}}>
                            <li className="flex items-center gap-3">
                                <div
                                    className={`checkbox ${task.done ? 'checked' : ''}`}
                                    onClick={() => toggleTask(task.id, task.done)}
                                >
                                    {task.done ? '✔' : ''}
                                </div>
                                <span className={task.done ? 'text-muted' : ''}>{task.name}</span>
                            </li>
                            <li className="flex items-center gap-3">
                                <button className="btn" onClick={() => deleteTask(task.id)}>
                                    削除
                                </button>
                            </li>
                        </div>
                    ))}
                </ul>
            </nav>
            <a href="/tasks/new" className="btn">
                新規タスク作成
            </a>
            <br></br>
        </main>
    );
}
