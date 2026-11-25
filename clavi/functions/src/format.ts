// 表示用の文字列を作る純粋関数（時間・日付・セッションの名前・数える記録）。
// 日付と時刻は実行環境のタイムゾーンで出すので、画面（ブラウザ）で使う。
// Functions が使うのは、タイムゾーンに依らないもの（formatDuration, sessionTitle）だけにすること。
// Web アプリからも import するので、Node に依存しないこと。

import { WEEKDAYS } from './calendar.ts';

/** セッションの名前。「資格 / 過去問 2時間00分」「作業 45分」の形。確認画面とサーバーで同じものを使う。 */
export function sessionTitle(
  { projectName, tag, requiredSec }: { projectName: string; tag: string; requiredSec: number },
): string {
  const target = [projectName, tag].filter(Boolean).join(' / ') || '作業';
  return `${target} ${formatDuration(requiredSec)}`;
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
  const clock = formatClock(ms);
  const day = formatDay(ms, now);
  return day === '今日' ? clock : `${day} ${clock}`;
}

/** 時刻の日付を「9/30（火）」の形にする。 */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

/** 時刻を「9:05」の形にする。 */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 何の記録を数えるか。「プロジェクト「資格」・タグ「過去問」」「すべての記録」の形。 */
export function targetLabel({ projectName, tag }: { projectName?: string; tag: string }): string {
  const parts = [
    projectName ? `プロジェクト「${projectName}」` : '',
    tag ? `タグ「${tag}」` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('・') : 'すべての記録';
}
