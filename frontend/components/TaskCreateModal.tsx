'use client';

import { useState, FormEvent, useEffect } from "react";
import { ScheduleInfo } from "@/dataType/task";

// 親コンポーネントから受け取るPropsの型定義
interface Props {
    isOpen: boolean;
    onClose: () => void;
    onTaskCreate: (taskData: { name: string; goalMinutes: number; scheduleInfo: ScheduleInfo }) => Promise<void>;
}

const WEEK_DAYS = ['日', '月', '火', '水', '木', '金', '土'];

export default function TaskCreateModal({ isOpen, onClose, onTaskCreate }: Props) {
    // フォームの状態管理
    const [name, setName] = useState('');
    const [goalMinutes, setGoalMinutes] = useState(60);
    const [type, setType] = useState<ScheduleInfo['type']>('daily');
    const [interval, setInterval] = useState(1);
    const [daysOfWeek, setDaysOfWeek] = useState(Array(7).fill(false));
    const [isSubmitting, setIsSubmitting] = useState(false);

    // モーダルが開いた時にフォームをリセット
    useEffect(() => {
        if (isOpen) {
            setName('');
            setGoalMinutes(60);
            setType('daily');
            setInterval(1);
            setDaysOfWeek(Array(7).fill(false));
        }
    }, [isOpen]);

    const handleDayOfWeekChange = (index: number) => {
        const newDays = [...daysOfWeek];
        newDays[index] = !newDays[index];
        setDaysOfWeek(newDays);
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (name.trim() === '' || isSubmitting) return;
        if (type === 'weekly' && !daysOfWeek.some(day => day)) {
            alert('週次タスクの場合は、曜日を少なくとも1つ選択してください。');
            return;
        }
        setIsSubmitting(true);

        await onTaskCreate({
            name,
            goalMinutes,
            scheduleInfo: {
                type,
                interval: Number(interval) || 1,
                daysOfWeek,
            },
        });

        setIsSubmitting(false);
        onClose(); // 成功したらモーダルを閉じる
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-md m-4">
                <h2 className="text-2xl font-bold mb-4">新しいタスクを作成</h2>
                <form onSubmit={handleSubmit}>
                    {/* タスク名 */}
                    <div className="mb-4">
                        <label htmlFor="name" className="block mb-2">タスク名</label>
                        <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required className="w-full p-2 border rounded-md dark:bg-gray-700" />
                    </div>

                    {/* 目標時間 */}
                    <div className="mb-4">
                        <label htmlFor="goalMinutes" className="block mb-2">目標時間 (分)</label>
                        <input id="goalMinutes" type="number" value={goalMinutes} onChange={(e) => setGoalMinutes(Number(e.target.value))} min="1" required className="w-full p-2 border rounded-md dark:bg-gray-700" />
                    </div>

                    {/* 繰り返し種別 */}
                    <div className="mb-4">
                        <span className="block mb-2">繰り返し</span>
                        <div className="flex gap-4">
                            <label><input type="radio" name="type" value="daily" checked={type === 'daily'} onChange={() => setType('daily')} /> 日次</label>
                            <label><input type="radio" name="type" value="weekly" checked={type === 'weekly'} onChange={() => setType('weekly')} /> 週次</label>
                        </div>
                    </div>

                    {/* 実行間隔 */}
                    <div className="mb-4">
                        <label htmlFor="interval" className="block mb-2">{type === 'daily' ? '何日おき' : '何週おき'}</label>
                        <input id="interval" type="number" value={interval} onChange={(e) => setInterval(Number(e.target.value))} min="1" required className="w-40 p-2 border rounded-md dark:bg-gray-700" />
                    </div>

                    {/* 曜日選択 (週次のみ) */}
                    {type === 'weekly' && (
                        <div className="mb-6">
                            <span className="block mb-2">実行する曜日</span>
                            <div className="flex flex-wrap gap-2">
                                {WEEK_DAYS.map((day, index) => (
                                    <label key={day} className={`p-2 rounded-md cursor-pointer ${daysOfWeek[index] ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-600'}`}>
                                        <input type="checkbox" checked={daysOfWeek[index]} onChange={() => handleDayOfWeekChange(index)} className="sr-only" />
                                        {day}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ボタン */}
                    <div className="flex justify-end gap-4">
                        <button type="button" onClick={onClose} className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600">キャンセル</button>
                        <button type="submit" disabled={isSubmitting} className="px-4 py-2 rounded-md bg-green-500 text-white disabled:bg-gray-400">
                            {isSubmitting ? '作成中...' : '作成'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}