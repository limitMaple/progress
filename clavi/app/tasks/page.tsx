"use client";

import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { collection, getDocs, updateDoc, doc } from "firebase/firestore";
import { db, app } from "@/lib/firebase";

type Task = { id: string; name: string; done: boolean };

export default function TasksPage() {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [viewDone, setViewDone] = useState<boolean>(false);
    const auth = getAuth(app);

    useEffect(() => {
        const fetchTasks = async () => {
            const q = collection(db, "users", auth.currentUser.uid, "tasks");
            const snapshot = await getDocs(q);
            const data = snapshot.docs.map((d) => ({
                id: d.id,
                ...d.data(),
            })) as Task[];
            setTasks(data);
        };
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

    const toggleView = async () => {
        setViewDone( prevState => !prevState);
    };

    return (
        <main>
            <nav className="nav" role="navigation">
                <h1>タスク一覧</h1>
                <ul>
                    {tasks.filter(task => task.done == viewDone).map(task => (
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
                        </div>
                    ))}
                </ul>
            </nav>
            <a href="/tasks/new" className="btn">
                新規タスク作成
            </a>
            <br></br>

            <br></br>

            <br></br>
            <button className="btn" onClick={() => toggleView()}>
                {viewDone ? "達成済みを表示" : "未達成を表示"}
            </button>
        </main>
    );
}
