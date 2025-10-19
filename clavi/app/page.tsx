import { redirect } from "next/navigation";
import { getAuth } from "firebase/auth";
import { app } from "@/lib/firebase";

export default function HomePage() {
    const auth = getAuth(app);
    if (!auth.currentUser) {
        redirect("/login");
    } else {
        redirect("/tasks");
    }
}
