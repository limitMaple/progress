"use client";

import { useState } from "react";
import { getAuth } from "firebase/auth";
import { collection, addDoc } from "firebase/firestore";
import { db, app } from "@/lib/firebase";
import { useRouter } from "next/navigation";

export default function NewTaskPage() {
    const [name, setName] = useState("");
    const auth = getAuth(app);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!auth.currentUser) return;
        if (name == "") return;
        const ref = collection(db, "users", auth.currentUser.uid,"tasks");
        await addDoc(ref, {
            name,
            done: false
        });

        router.push("/tasks");
    };

    return (
        <main>
            <h1>新規タスク作成</h1>
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="タスク名"
                />
                <button type="submit">
                    作成
                </button>
            </form>
        </main>
    );
}
