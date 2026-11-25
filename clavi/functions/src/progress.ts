// Toggl の記録から進捗（数えた秒数）を計算する。Web アプリからも import するので、Node に依存しないこと。

import type { TimeEntry } from './api.ts';

/**
 * Toggl の time entry のうち、[from, to) に重なる部分の合計秒数を返す。
 * projectId を指定した場合はそのプロジェクトの記録だけ、tag を指定した場合はそのタグが付いた
 * 記録だけを数える。両方指定したら両方を満たす記録だけ。
 * 計測中の記録（stop が null）は now まで続いているものとして扱う。
 */
export function trackedSeconds(
  entries: readonly TimeEntry[],
  { from, to, tag, projectId }: { from: number; to: number; tag?: string; projectId?: number | null },
  now: number,
): number {
  let totalMs = 0;
  for (const entry of entries) {
    if (projectId != null && entry.project_id !== projectId) continue;
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
