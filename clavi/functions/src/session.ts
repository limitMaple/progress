// セッション（「締切までに指定の時間やる」という 1 件の約束）の振る舞い。
// 保存する形は model.ts の SessionData。Web アプリからも import するので、Node に依存しないこと。

import { formatDuration, sessionTitle, trackedSeconds } from './progress.ts';
import type {
  ChargeRecord, SessionData, SessionStatus, TimeEntry, TogglProject,
} from './model.ts';

// 締切ちょうどの記録も拾えるよう、少しだけ待ってから精算する
const SETTLE_DELAY = 30 * 1000;
// 精算が重なって二重に課金しないよう、取りかかったセッションはこの間ロックする
const CLAIM_TTL = 5 * 60 * 1000;
// 課金の前に失敗したときの再試行
const RETRY_DELAY = 60 * 1000;
const MAX_ATTEMPTS = 3;

/** 表示用の状態。settling は「締切を過ぎた active」（精算を待っている）。 */
export type DisplayStatus = SessionStatus | 'settling';

/** 保存する差分。状態を変えるメソッドはこれを返し、呼ぶ側が Firestore の update に渡す。 */
export type SessionPatch = Partial<SessionData>;

/** data の項目を、そのまま読み取り専用のプロパティとして持つクラスの土台（項目を 2 か所に書かないため）。 */
function recordClass<T extends object>() {
  return class {
    constructor(data: T) {
      Object.assign(this, data);
    }
  } as new (data: T) => Readonly<T>;
}

export class Session extends recordClass<SessionData>() {
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
  with(patch: SessionPatch): Session {
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

  // ---- 状態の移り変わり（どれも保存する差分を返す。自身は変えない） ----

  /**
   * Toggl で測った進捗。締切前に作業時間へ届いていれば達成にする。
   * 締切後は達成にしない。Toggl には過去の時刻で記録を足せるので、締切後に足した記録で
   * 課金を逃れられてしまう。締切後の判定は精算（settleAs〜）だけが行う。
   */
  progress(trackedSec: number, now: number): SessionPatch {
    const patch: SessionPatch = { trackedSec, updatedAt: now };
    return trackedSec >= this.requiredSec && now < this.due
      ? { ...patch, status: 'done', checkAt: null }
      : patch;
  }

  /** 課金 API を呼ぶ直前の印。これより後で失敗したら、課金されたか分からない状態になる。 */
  requestCharge(now: number): SessionPatch {
    return { chargeRequestedAt: now, checkAt: null };
  }

  /** 精算した結果、作業時間に届いていた。 */
  settleAsDone(trackedSec: number): SessionPatch {
    return this.finish('done', `達成しました（${formatDuration(trackedSec)}）。課金はありません。`);
  }

  /** 精算した結果、届いていなかったので課金した。 */
  settleAsCharged(trackedSec: number, charge: ChargeRecord): SessionPatch {
    return this.finish(
      'charged',
      `届きませんでした（${this.progressLabel(trackedSec)}）。$${this.dollars}を課金しました。`,
      charge,
    );
  }

  /** 課金されたか分からなかったものを、人が Beeminder の履歴で確かめて「課金されていた」とした。 */
  settleAsChargedManually(now: number): SessionPatch {
    return this.finish(
      'charged',
      `課金済みとして記録しました（Beeminderの履歴で確認, $${this.dollars}）。`,
      { id: '', amount: this.dollars, at: now, manual: true },
    );
  }

  /** 課金の前に失敗した。1 分後にやり直し、MAX_ATTEMPTS 回目なら status を 'error' にして止める。 */
  retryLater(error: string, now: number): SessionPatch {
    const attempts = this.nextAttempt;
    if (attempts >= MAX_ATTEMPTS) {
      return this.stop(`精算に失敗しました: ${error}`);
    }
    const retryAt = now + RETRY_DELAY;
    // 締切後の処理なので status は変えない
    return {
      settle: {
        attempts,
        retryAt,
        message: `精算に失敗したので、1分後にやり直します（${attempts}/${MAX_ATTEMPTS}）: ${error}`,
      },
      checkAt: retryAt,
      claimedAt: null,
    };
  }

  /** 課金 API の途中で失敗した。課金されたか分からないので、人が確かめるまで止める。 */
  stopForReview(error: string): SessionPatch {
    return this.stop(
      `課金されたか分かりません（${error}）。`
      + 'Beeminderの課金履歴を確かめて、画面から「課金されていた / いなかった」を選んでください。',
    );
  }

  private get nextAttempt(): number {
    return (this.settle?.attempts ?? 0) + 1;
  }

  private finish(status: 'done' | 'charged', message: string, charge: ChargeRecord | null = null): SessionPatch {
    return {
      status,
      charge,
      settle: { attempts: this.nextAttempt, retryAt: null, message },
      checkAt: null,
      claimedAt: null,
    };
  }

  private stop(message: string): SessionPatch {
    return {
      status: 'error',
      settle: { attempts: this.nextAttempt, retryAt: null, message },
      checkAt: null,
      claimedAt: null,
    };
  }

  // ---- 表示用 ----

  displayStatus(now: number): DisplayStatus {
    return this.status === 'active' && now >= this.due ? 'settling' : this.status;
  }

  /** 作業時間に対する進み具合（0〜1）。 */
  get progressRatio(): number {
    return Math.min(1, this.trackedSec / this.requiredSec);
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
