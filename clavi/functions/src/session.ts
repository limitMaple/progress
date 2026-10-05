// セッション（「締切までに指定の時間やる」という 1 件の約束）の振る舞い。
// 保存する形は model.ts の SessionData。Web アプリからも import するので、Node に依存しないこと。

import { formatDuration, sessionTitle, trackedSeconds } from './progress.ts';
import type {
  ChargeRecord, SessionData, SessionStatus, SettleState, TimeEntry, TogglProject,
} from './model.ts';

// 締切ちょうどの記録も拾えるよう、少しだけ待ってから精算する
const SETTLE_DELAY = 30 * 1000;
// 精算が重なって二重に課金しないよう、取りかかったセッションはこの間ロックする
const CLAIM_TTL = 5 * 60 * 1000;

/** 表示用の状態。settling は「締切を過ぎた active」（精算を待っている）。 */
export type DisplayStatus = SessionStatus | 'settling';

export class Session implements SessionData {
  declare readonly id: string;
  declare readonly title: string;
  declare readonly projectId: number | null;
  declare readonly projectName: string;
  declare readonly tag: string;
  declare readonly requiredSec: number;
  declare readonly createdAt: number;
  declare readonly startAt: number;
  declare readonly due: number;
  declare readonly dollars: number;
  declare readonly status: SessionStatus;
  declare readonly trackedSec: number;
  declare readonly updatedAt: number | null;
  declare readonly settle: SettleState | null;
  declare readonly charge: ChargeRecord | null;
  declare readonly checkAt: number | null;
  declare readonly claimedAt: number | null;
  declare readonly chargeRequestedAt: number | null;
  declare readonly measuredSec: number | null;

  constructor(data: SessionData) {
    Object.assign(this, data);
  }

  /** 新しく始めるセッション。now は作成時刻。 */
  static start({ id, now, project, tag, requiredSec, startAt, due, dollars }: {
    id: string;
    now: number;
    project: TogglProject | null;
    tag: string;
    requiredSec: number;
    startAt: number;
    due: number;
    dollars: number;
  }): Session {
    const projectName = project?.name ?? '';
    return new Session({
      id,
      title: sessionTitle({ projectName, tag, requiredSec }),
      projectId: project?.id ?? null,
      projectName,
      tag,
      requiredSec,
      createdAt: now,
      startAt,
      due,
      dollars,
      status: 'active',
      trackedSec: 0,
      updatedAt: null,
      settle: null,
      charge: null,
      checkAt: due + SETTLE_DELAY,
      claimedAt: null,
      chargeRequestedAt: null,
      measuredSec: null,
    });
  }

  /** 一部を書き換えた新しいセッション（自身は変えない）。 */
  with(patch: Partial<SessionData>): Session {
    return new Session({ ...this, ...patch });
  }

  /** 次に精算する時刻。再試行の予定があればそれ、なければ締切の少し後。 */
  settleTime(): number {
    return this.settle?.retryAt ?? this.due + SETTLE_DELAY;
  }

  /** Toggl の記録のうち、このセッションで数える秒数。カウント開始より前と締切より後は数えない。 */
  measure(entries: readonly TimeEntry[], now: number): number {
    return trackedSeconds(
      entries,
      { from: this.startAt, to: Math.min(now, this.due), tag: this.tag, projectId: this.projectId },
      now,
    );
  }

  /** trackedSec で作業時間に届いているか。 */
  isReached(trackedSec: number): boolean {
    return trackedSec >= this.requiredSec;
  }

  /** 精算が済んでいる（達成か課金済み）。一覧から消せるのはこれだけ。 */
  get isSettled(): boolean {
    return this.status === 'done' || this.status === 'charged';
  }

  /** 課金 API の途中で失敗して、課金されたか分からない。人が Beeminder の履歴で確かめる */
  get isChargeUnknown(): boolean {
    return Boolean(this.chargeRequestedAt) && !this.charge;
  }

  /**
   * 精算に取りかかれるか（claimSettlement が使う）。
   * 課金されたか分からないものは、resolving（人が確かめた）のときだけ取りかかれる。
   */
  isClaimable(now: number, { resolving = false } = {}): boolean {
    if (this.charge) return false;
    if (this.status !== 'active' && this.status !== 'error') return false;
    if (this.chargeRequestedAt && !resolving) return false;
    return !(this.claimedAt && now - this.claimedAt < CLAIM_TTL);
  }

  /** Beeminder の課金に付けるメモ。履歴と突き合わせられるよう、ID の頭を入れておく。 */
  chargeNote(): string {
    return `Toggl Ratchet: ${this.title} (${this.id.slice(0, 8)})`;
  }

  // ---- 表示用 ----

  displayStatus(now: number): DisplayStatus {
    return this.status === 'active' && now >= this.due ? 'settling' : this.status;
  }

  /** 締切までの残り（ms）。過ぎていれば負。 */
  remainingMs(now: number): number {
    return this.due - now;
  }

  /** 作業時間に対する進み具合（0〜1）。 */
  get progressRatio(): number {
    return Math.min(1, this.trackedSec / this.requiredSec);
  }

  /** 作業時間まであと何秒か。届いていれば 0 以下。 */
  get leftSec(): number {
    return this.requiredSec - this.trackedSec;
  }

  /** カウント開始を指定したか（指定しなければ作成時刻と同じ）。 */
  get hasCustomStart(): boolean {
    return this.startAt !== this.createdAt;
  }

  /** 「1時間05分 / 2時間00分」の形。 */
  progressLabel(trackedSec = this.trackedSec): string {
    return `${formatDuration(trackedSec)} / ${formatDuration(this.requiredSec)}`;
  }
}
