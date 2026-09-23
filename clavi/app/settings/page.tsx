"use client";

import SignedIn from "@/components/SignedIn";
import SettingsForm from "@/components/SettingsForm";

export default function SettingsPage() {
    return <SignedIn>{(user) => <SettingsForm uid={user.uid} />}</SignedIn>;
}
