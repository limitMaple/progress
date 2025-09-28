"use client";

import { useState, useEffect } from "react";
import { auth, provider, db } from "@/lib/firebase";
import { signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { collection, addDoc, query, where, getDocs, updateDoc, doc } from "firebase/firestore";

interface Task {
    id: string;
    name: string;
    completed: boolean;
}

export default function Page() {
    const [user, setUser] = useState<User | null>(null);
    const [taskName, setTaskName] = useState("");
    const [tasks, setTasks] = useState<Task[]>([]);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setUser(currentUser);
            if (currentUser) await fetchTasks(currentUser.uid);
        });
        return () => unsubscribe();
    }, []);

    const fetchTasks = async (uid: string) => {
        const q = query(collection(db, "tasks"), where("uid", "==", uid));
        const snapshot = await getDocs(q);
        const taskList: Task[] = snapshot.docs.map((doc) => ({
            id: doc.id,
            name: doc.data().name,
            completed: doc.data().completed,
        }));
        setTasks(taskList);
    };

    const handleLogin = async () => {
        await signInWithPopup(auth, provider);
    };

    const handleLogout = async () => {
        await signOut(auth);
        setTasks([]);
    };

    const handleAddTask = async () => {
        if (!taskName || !user) return;
        const docRef = await addDoc(collection(db, "tasks"), {
            name: taskName,
            completed: false,
            uid: user.uid,
        });
        setTasks([...tasks, { id: docRef.id, name: taskName, completed: false }]);
        setTaskName("");
    };

    const toggleComplete = async (task: Task) => {
        const taskRef = doc(db, "tasks", task.id);
        await updateDoc(taskRef, { completed: !task.completed });
        setTasks(tasks.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)));
    };

    return (
        <div>
            {!user ? (
                <button
                    onClick={handleLogin}
                    className="px-4 py-2 bg-blue-500 text-white rounded"
                >
                    Googleでログイン
                </button>
            ) : (
                <div>
                    <div className="mb-4 flex justify-between items-center">
                        <span>ようこそ、{user.displayName}</span>
                        <button
                            onClick={handleLogout}
                            className="px-4 py-2 bg-gray-300 rounded"
                        >
                            ログアウト
                        </button>
                    </div>

                    <div className="mb-4 flex gap-2">
                        <input
                            type="text"
                            value={taskName}
                            onChange={(e) => setTaskName(e.target.value)}
                            placeholder="タスク名"
                            className="p-2 border rounded flex-1"
                        />
                        <button
                            onClick={handleAddTask}
                            className="px-4 py-2 bg-green-500 text-white rounded"
                        >
                            タスク追加
                        </button>
                    </div>

                    <ul>
                        {tasks.map((task) => (
                            <li key={task.id} className="flex items-center gap-2 mb-2">
                                <input
                                    type="checkbox"
                                    checked={task.completed}
                                    onChange={() => toggleComplete(task)}
                                />
                                <span className={task.completed ? "line-through" : ""}>{task.name}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
