'use client';

import { useAuth } from "@/auth/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Task, TaskSchedule, ScheduleInfo } from "@/dataType/task";
import {
    addDoc,
    deleteDoc,
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    Timestamp,
    getDocs,
    where
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import TaskCreateModal from "@/components/TaskCreateModal"; // 作成したモーダルをインポート


// --- スケジュール生成判定ヘルパー関数 ---
const isExecutionDay = (task: Task, date: Date): boolean => {
    const { scheduleInfo, createdAt } = task;
    const { type, interval, daysOfWeek } = scheduleInfo;
    const startDate = createdAt.toDate();

    const checkDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    checkDate.setHours(0, 0, 0, 0);

    const diffTime = checkDate.getTime() - startDate.getTime();
    if (diffTime < 0) return false; // 作成日より前の日付は対象外

    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (type === 'daily') {
        return diffDays % interval === 0;
    }

    if (type === 'weekly') {
        const todayDayOfWeek = checkDate.getDay(); // 0 (日) - 6 (土)
        if (!daysOfWeek || !daysOfWeek[todayDayOfWeek]) {
            return false; // 曜日が対象外
        }

        const startDayOfWeek = startDate.getDay();
        const firstDayOfStartDateWeek = new Date(startDate.setDate(startDate.getDate() - startDayOfWeek));
        const firstDayOfCheckDateWeek = new Date(checkDate.setDate(checkDate.getDate() - todayDayOfWeek));

        const diffWeeks = Math.round((firstDayOfCheckDateWeek.getTime() - firstDayOfStartDateWeek.getTime()) / (1000 * 60 * 60 * 24 * 7));

        return diffWeeks % interval === 0;
    }

    return false;
};

// スケジュール情報を人間が読める文字列に変換するヘルパー関数
const formatScheduleInfo = (scheduleInfo: ScheduleInfo): string => {
    const { type, interval, daysOfWeek } = scheduleInfo;
    const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土'];

    if (type === 'daily') {
        return interval === 1 ? '毎日' : `${interval}日ごと`;
    }

    if (type === 'weekly') {
        const selectedDays = daysOfWeek
            .map((isSelected, index) => (isSelected ? WEEK_DAYS[index] : null))
            .filter(Boolean)
            .join('・');
        const prefix = interval === 1 ? '毎週' : `${interval}週ごと`;
        return `${prefix} (${selectedDays})`;
    }

    return 'スケジュール未設定';
};

export default function TaskPage() {
    const { user, loading } = useAuth();
    const router = useRouter();

    const [taskSchedules, setTaskSchedules] = useState<TaskSchedule[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // --- 認証チェック ---
    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        }
    }, [user, loading, router]);

    // --- メインのスケジュール生成＆監視ロジック ---
    const checkAndGenerateSchedules = useCallback(async () => {
        if (!user) return;

        const todayStr = new Date().toISOString().split('T')[0];
        const lastGeneratedDate = localStorage.getItem('lastScheduleGenDate');

        // 1. 今日すでに生成済みなら処理をスキップ
        if (lastGeneratedDate === todayStr) {
            console.log("Schedules already generated today.");
            return;
        }

        console.log("Generating schedules for today...");

        // 2. ユーザーの全タスク定義を取得
        const tasksQuery = query(collection(db, `users/${user.uid}/tasks`), where('isActive', '==', true));
        const tasksSnapshot = await getDocs(tasksQuery);
        const allTasks: Task[] = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));

        // 3. 今日の既存スケジュールをチェック (重複作成防止)
        const todayStart = new Date(todayStr);
        const schedulesQuery = query(collection(db, `users/${user.uid}/taskSchedules`), where('termStart', '==', Timestamp.fromDate(todayStart)));
        const existingSchedulesSnapshot = await getDocs(schedulesQuery);
        const existingTaskIds = new Set(existingSchedulesSnapshot.docs.map(doc => doc.data().taskId));

        // 4. 新規スケジュールを生成
        const today = new Date();
        for (const task of allTasks) {
            if (isExecutionDay(task, today) && !existingTaskIds.has(task.id)) {
                console.log(`Generating schedule for task: ${task.name}`);
                const startOfDay = new Date(today.setHours(0, 0, 0, 0));
                const endOfDay = new Date(today.setHours(23, 59, 59, 999));

                await addDoc(collection(db, `users/${user.uid}/taskSchedules`), {
                    taskId: task.id,
                    termStart: Timestamp.fromDate(startOfDay),
                    termEnd: Timestamp.fromDate(endOfDay),
                    goalMinutes: task.goalMinutes,
                    progressMinutes: 0,
                    progressSeconds: 0,
                    isCompleted: false,
                    completedAt: null,
                    taskInfo: { name: task.name }
                });
            }
        }

        // 5. 最終生成日を更新
        localStorage.setItem('lastScheduleGenDate', todayStr);

    }, [user]);

    useEffect(() => {
        if (user) {
            // スケジュール生成処理を実行
            checkAndGenerateSchedules().then(() => {
                // 生成処理が終わった後、今日のスケジュールをリアルタイムで監視開始
                const todayStr = new Date().toISOString().split('T')[0];
                const todayStart = new Date(todayStr);

                const q = query(
                    collection(db, `users/${user.uid}/taskSchedules`),
                    where('termStart', '==', Timestamp.fromDate(todayStart))
                );

                const unsubscribe = onSnapshot(q, (querySnapshot) => {
                    const schedules: TaskSchedule[] = [];
                    querySnapshot.forEach((doc) => {
                        schedules.push({ id: doc.id, ...doc.data() } as TaskSchedule);
                    });
                    setTaskSchedules(schedules);
                    setIsLoading(false);
                });

                return () => unsubscribe();
            });
        }
    }, [user, checkAndGenerateSchedules]);

    // --- タスクのリアルタイム取得 ---
    useEffect(() => {
        if (user) {
            const tasksCollectionRef = collection(db, `users/${user.uid}/tasks`);
            const q = query(tasksCollectionRef, orderBy('createdAt', 'desc'));

            const unsubscribe = onSnapshot(q, (querySnapshot) => {
                const tasksData: Task[] = [];
                querySnapshot.forEach((doc) => {
                    // ドキュメントデータとIDをマージしてTask型としてプッシュ
                    tasksData.push({ id: doc.id, ...doc.data() } as Task);
                });
                setTasks(tasksData);
                setIsLoading(false);
            }, (error) => {
                console.error("タスクの取得エラー: ", error);
                setIsLoading(false);
            });

            // コンポーネントがアンマウントされる時に監視を解除
            return () => unsubscribe();
        }
    }, [user]);

    // --- タスク定義の作成ハンドラ ---
    const handleCreateTaskDefinition = async (taskData: { name: string; goalMinutes: number; scheduleInfo: ScheduleInfo }) => {
        if (!user) return;
        try {
            await addDoc(collection(db, `users/${user.uid}/tasks`), {
                ...taskData,
                isActive: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            // 新しいタスクを追加したら、スケジュールを再チェックする
            await checkAndGenerateSchedules();
        } catch (error) {
            console.error("タスク定義作成エラー: ", error);
            alert("タスクの作成に失敗しました。");
        }
    };

    // --- タスクの削除機能 ---
    const handleDeleteTask = async (taskId: string) => {
        if (!user || !window.confirm("このタスクを削除しますか？\n関連する過去のスケジュールや記録は残りますが、今後のスケジュールは生成されなくなります。")) {
            return;
        }

        try {
            const taskDocRef = doc(db, `users/${user.uid}/tasks`, taskId);
            await deleteDoc(taskDocRef);
            alert("タスクを削除しました。");
        } catch (error) {
            console.error("タスクの削除エラー: ", error);
            alert("削除に失敗しました。");
        }
    };

    if (loading || isLoading) {
        return <p>読み込み中...</p>;
    }

    return (
        <div>
            <TaskCreateModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onTaskCreate={handleCreateTaskDefinition}
            />
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold">今日のタスク</h2>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
                >
                    ＋ 新規タスク定義
                </button>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md">
                {tasks.length === 0 ? (
                    <p className="p-6 text-center text-gray-500">タスクがありません。</p>
                ) : (
                    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                        {tasks.map((task) => (
                            <li key={task.id} className="p-4 flex justify-between items-center">
                                <div className="flex-1">
                                    <p className="font-semibold text-lg">{task.name}</p>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        目標: {task.goalMinutes}分
                                    </p>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        スケジュール: {formatScheduleInfo(task.scheduleInfo)}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        // TODO: 編集機能を後で実装
                                        className="p-2 text-gray-500 hover:text-blue-500"
                                        aria-label="編集"
                                    >
                                        {/* 編集アイコン */}
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                                            <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={() => handleDeleteTask(task.id)}
                                        className="p-2 text-gray-500 hover:text-red-500"
                                        aria-label="削除"
                                    >
                                        {/* 削除アイコン */}
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}