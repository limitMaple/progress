'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function Header() {
    const router = useRouter();

    const handleLogout = async () => {
    };

    return (
        <header className="bg-white dark:bg-gray-800 shadow-md sticky top-0 z-10">
            <nav className="container mx-auto px-6 py-3">
                <div className="flex justify-between items-center">
                    <Link href="/frontend/public" className="text-xl font-bold text-blue-600 dark:text-blue-400">
                        AI PWA
                    </Link>
                </div>
            </nav>
        </header>
    );
}