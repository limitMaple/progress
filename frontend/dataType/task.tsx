import { Timestamp } from "firebase/firestore";

export interface ScheduleInfo {
    type: 'daily' | 'weekly'; // まずは日次・週次で実装
    interval: number;         // n日おき、n週おき
    daysOfWeek: boolean[];    // 長さ7の配列 [日, 月, 火, 水, 木, 金, 土]
}

// タスクの定義
export interface Task {
    id: string;
    name: string;
    tags: string[];
    scheduleInfo: ScheduleInfo;
    goalMinutes: number;
    isActive: boolean;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

// 期間ごとのタスクインスタンス
export interface TaskSchedule {
    id: string;
    taskId: string;
    termStart: Timestamp;
    termEnd: Timestamp;
    goalMinutes: number;
    progressMinutes: number;
    progressSeconds: number;
    isCompleted: boolean;
    completedAt: Timestamp | null;
}