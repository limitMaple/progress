// 進捗計算と表示用の純粋関数。Web アプリからも import するので、Node に依存しないこと。

import type { TimeEntry } from './model.js';

/**
 * Toggl の time entry のうち、[from, to) に重なる部分の合計秒数を返す。
 * tag を指定した場合は、そのタグが付いた記録だけを数える。
 * 計測中の記録（stop が null）は now まで続いているものとして扱う。
 */
export function trackedSeconds(
  entries: readonly TimeEntry[],
  { from, to, tag }: { from: number; to: number; tag?: string },
  now: number,
): number {
  let totalMs = 0;
  for (const entry of entries) {
    if (tag && !(entry.tags ?? []).includes(tag)) continue;
    const start = Date.parse(entry.start);
    const stop = entry.stop
      ? Date.parse(entry.stop)
      : entry.duration < 0
        ? now
        : start + entry.duration * 1000;
    const overlap = Math.min(stop, to) - Math.max(start, from);
    if (overlap > 0) totalMs += overlap;
  }
  return Math.floor(totalMs / 1000);
}

/**
 * "HH:MM" を now 以降で最も近いその時刻に変換する（ms）。
 * 今日のその時刻を過ぎていれば翌日扱い。実行環境のタイムゾーンで解釈するので、ブラウザで呼ぶこと。
 */
export function resolveDeadline(hhmm: string, now: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** now から minMs 以上先の時刻を、stepMin 分単位に切り上げて "HH:MM" で返す。 */
export function defaultDeadline(now: number, minMs: number, stepMin = 10): string {
  const step = stepMin * 60 * 1000;
  const d = new Date(Math.ceil((now + minMs) / step) * step);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 秒数を「1時間05分」「45分」の形にする（分未満は切り捨て）。 */
export function formatDuration(sec: number): string {
  const totalMin = Math.max(0, Math.floor(sec / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}時間${pad(m)}分` : `${m}分`;
}

/** 日付を now から見た「今日」「明日」「9/18」の形にする。 */
export function formatDay(ms: number, now: number): string {
  const dayDiff = Math.round((startOfDay(ms) - startOfDay(now)) / 86400000);
  if (dayDiff === 0) return '今日';
  if (dayDiff === 1) return '明日';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 時刻を「23:30」「明日 1:00」「9/18 8:00」の形にする（今日なら日付を省く）。 */
export function formatDeadline(ms: number, now: number): string {
  const d = new Date(ms);
  const clock = `${d.getHours()}:${pad(d.getMinutes())}`;
  const day = formatDay(ms, now);
  return day === '今日' ? clock : `${day} ${clock}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
