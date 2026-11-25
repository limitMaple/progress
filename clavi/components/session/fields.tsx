"use client";

import { useId, useState, type ChangeEvent, type ChangeEventHandler, type ReactNode } from "react";
import type { TogglProject } from "@/functions/src/model";

// 「新しいセッション」と「新しいスケジュール」で同じ入力欄をここに置く。
// どの部品も values と change を受け取り、自分が使うキーだけを見る（呼ぶ側は change={change} と書くだけ）。
// 2 つのフォームで形が違う欄（カウント開始・締切・取り消し・繰り返し）は、それぞれのフォームに置く。

/** キーを渡すと、その欄の onChange になるもの。useFormValues が作る。 */
export type Change<K extends string> = (key: K) => ChangeEventHandler<HTMLInputElement | HTMLSelectElement>;

/** 文字列を入れるキーだけ。change に渡せるのはこれだけにする（繰り返しのような値は setValues で直す）。 */
type StringKeys<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T];

/** 入力欄の値をまとめて持つ。どれも input / select の value なので文字列で持つ。 */
export function useFormValues<T extends object>(initial: () => T) {
    const [values, setValues] = useState(initial);
    const change = ((key: StringKeys<T>) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { value } = e.target;
        // キーは T のものなので、入れた形も T のまま
        setValues((v) => ({ ...v, [key]: value }) as T);
    }) as Change<StringKeys<T> & string>;
    return { values, setValues, change };
}

/** 秒を「時間」「分」の入力欄の値にする。 */
export function durationValues(requiredSec: number): { hours: string; minutes: string } {
    return {
        hours: String(Math.floor(requiredSec / 3600)),
        minutes: String(Math.floor((requiredSec % 3600) / 60)),
    };
}

/** 「時間」「分」の入力欄から秒を読む。 */
export function requiredSecOf({ hours, minutes }: { hours: string; minutes: string }): number {
    return (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60;
}

/** 金額の入力欄からドルを読む。 */
export function dollarsOf({ dollars }: { dollars: string }): number {
    return Math.floor(Number(dollars) || 0);
}

export function ProjectField({ values, change, projects }: {
    values: { projectId: string };
    change: Change<"projectId">;
    projects: TogglProject[];
}) {
    return (
        <label>
            <span>プロジェクト</span>
            <select value={values.projectId} onChange={change("projectId")}>
                <option value="">指定なし</option>
                {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
        </label>
    );
}

export function TagField({ values, change, tags }: {
    values: { tag: string };
    change: Change<"tag">;
    tags: string[];
}) {
    // 2 つのフォームが同時に描かれているので、候補の一覧の id は部品ごとに分ける
    const listId = useId();
    return (
        <>
            <label>
                <span>タグ</span>
                <input
                    list={listId}
                    placeholder="空欄ならタグで絞らない"
                    autoComplete="off"
                    value={values.tag}
                    onChange={change("tag")}
                />
            </label>
            <datalist id={listId}>
                {tags.map((name) => <option key={name} value={name} />)}
            </datalist>
        </>
    );
}

/** 作業時間。スケジュールは 1 日に収まる必要があるので、上限は呼ぶ側が決める。 */
export function DurationField({ values, change, maxHours }: {
    values: { hours: string; minutes: string };
    change: Change<"hours" | "minutes">;
    maxHours: number;
}) {
    return (
        <label>
            <span>作業時間</span>
            <span className="row">
                <input
                    type="number" min="0" max={maxHours} className="num"
                    value={values.hours} onChange={change("hours")}
                />時間
                <input
                    type="number" min="0" max="59" step="5" className="num"
                    value={values.minutes} onChange={change("minutes")}
                />分
            </span>
        </label>
    );
}

export function DollarsField({ values, change }: {
    values: { dollars: string };
    change: Change<"dollars">;
}) {
    return (
        <label>
            <span>金額</span>
            <span className="row">
                $<input
                    type="number" min="1" step="1" className="num"
                    value={values.dollars} onChange={change("dollars")}
                />
            </span>
        </label>
    );
}

/** フォームの最後の行。入力が正しくなければ、理由を出してボタンを押せなくする。 */
export function SubmitRow({ hint, error, disabled, children }: {
    /** 出す文。error があればそれを出す */
    hint: string;
    error: string;
    disabled: boolean;
    /** ボタンの文字 */
    children: ReactNode;
}) {
    return (
        <>
            <p className={`hint ${error ? "error" : ""}`}>{hint}</p>
            <button type="submit" className="primary" disabled={disabled || Boolean(error)}>
                {children}
            </button>
        </>
    );
}
