"use client";

import SignedIn from "@/components/SignedIn";
import Sessions from "@/components/Sessions";

export default function HomePage() {
    return <SignedIn>{(user) => <Sessions uid={user.uid} />}</SignedIn>;
}
