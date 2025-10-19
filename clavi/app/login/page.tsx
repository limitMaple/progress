"use client";

import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { app } from "@/lib/firebase";

export default function LoginPage() {
    const handleLogin = async () => {
        const auth = getAuth(app);
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        window.location.href = "/tasks";
    };

    return (
        <main>
            <button className="btn"
                onClick={handleLogin}
            >
                Googleでログイン
            </button>
        </main>
    );
}
