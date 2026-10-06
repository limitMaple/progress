// セッション（「締切までに指定の時間やる」という 1 件の約束）の振る舞い。
// 保存する形は model.ts の SessionData。Web アプリからも import するので、Node に依存しないこと。
//
// 状態を変えるメソッド（「状態の移り変わり」の節）は自身を書き換え、変えた項目を覚えておく。
// 保存は store.ts の saveChanges で、変わった項目だけを update する（同時に動くほかの処理の書き込みを潰さない）。
// 画面は表示用のメソッドだけを使い、状態を変えるメソッドは呼ばないこと（React の state を書き換えてしまう）。

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

/** data の項目を、そのままプロパティとして持つクラスの土台（項目を 2 か所に書かないため）。 */
function recordClass<T extends object>() {
  return class {
    constructor(data: T) {
      Object.assign(this, data);
    }
  } as new (data: T) => T;
}

export class Session extends recordClass<SessionData>() {
  // # の項目は列挙されないので、Firestore に保存する項目（{ ...session }）には入らない
  #changes: Partial<SessionData> = {};

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

  /** まだ保存していない変更。 */
  get changes(): Partial<SessionData> {
    return { ...this.#changes };
  }

  /** 変更を保存し終えたら呼ぶ。 */
  clearChanges(): void {
    this.#changes = {};
  }

  private change(patch: Partial<SessionData>): void {
    Object.assign(this, patch);
    Object.assign(this.#changes, patch);
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

  // ---- 状態の移り変わり（自身を書き換える。保存は saveChanges） ----

  /** 精算に取りかかる（ロックを取る）。取れるかは isClaimable で確かめてから。 */
  claim(now: number): void {
    this.change({ claimedAt: now });
  }

  /**
   * Toggl で測った進捗。締切前に作業時間へ届いていれば達成にする。
   * 締切後は達成にしない。Toggl には過去の時刻で記録を足せるので、締切後に足した記録で
   * 課金を逃れられてしまう。締切後の判定は精算（settleAs〜）だけが行う。
   */
  progress(trackedSec: number, now: number): void {
    this.change({ trackedSec, updatedAt: now });
    if (trackedSec >= this.requiredSec && now < this.due) {
      this.change({ status: 'done', checkAt: null });
    }
  }

  /** 精算で最初に測った作業時間を残す。再試行ではこれを使い、Toggl を測り直さない。 */
  recordMeasured(trackedSec: number): void {
    this.change({ measuredSec: trackedSec });
  }

  /** 課金 API を呼ぶ直前の印。これより後で失敗したら、課金されたか分からない状態になる。 */
  requestCharge(now: number): void {
    this.change({ chargeRequestedAt: now, checkAt: null });
  }

  /** 人が Beeminder の履歴で「課金されていなかった」と確かめた。印を消して、精算をやり直せるようにする。 */
  clearChargeRequest(): void {
    this.change({ chargeRequestedAt: null });
  }

  /** 精算した結果、作業時間に届いていた。 */
  settleAsDone(trackedSec: number): void {
    this.finish('done', `達成しました（${formatDuration(trackedSec)}）。課金はありません。`);
  }

  /** 精算した結果、届いていなかったので課金した。 */
  settleAsCharged(trackedSec: number, charge: ChargeRecord): void {
    this.finish(
      'charged',
      `届きませんでした（${this.progressLabel(trackedSec)}）。$${this.dollars}を課金しました。`,
      charge,
    );
  }

  /** 課金されたか分からなかったものを、人が Beeminder の履歴で確かめて「課金されていた」とした。 */
  settleAsChargedManually(now: number): void {
    this.finish(
      'charged',
      `課金済みとして記録しました（Beeminderの履歴で確認, $${this.dollars}）。`,
      { id: '', amount: this.dollars, at: now, manual: true },
    );
  }

  /**
   * 課金の前に失敗した。1 分後にやり直し、MAX_ATTEMPTS 回目なら status を 'error' にして止める。
   * 課金 API は呼んでいないので、requestCharge の印は（保存に失敗して残っていても）消す。
   */
  retryLater(error: string, now: number): void {
    const attempts = this.nextAttempt;
    this.change({ chargeRequestedAt: null });
    if (attempts >= MAX_ATTEMPTS) {
      this.stop(`精算に失敗しました: ${error}`);
      return;
    }
    const retryAt = now + RETRY_DELAY;
    // 締切後の処理なので status は変えない
    this.change({
      settle: {
        attempts,
        retryAt,
        message: `精算に失敗したので、1分後にやり直します（${attempts}/${MAX_ATTEMPTS}）: ${error}`,
      },
      checkAt: retryAt,
      claimedAt: null,
    });
  }

  /** 課金 API の途中で失敗した。課金されたか分からないので、人が確かめるまで止める。 */
  stopForReview(error: string): void {
    this.stop(
      `課金されたか分かりません（${error}）。`
      + 'Beeminderの課金履歴を確かめて、画面から「課金されていた / いなかった」を選んでください。',
    );
  }

  private get nextAttempt(): number {
    return (this.settle?.attempts ?? 0) + 1;
  }

  private finish(status: 'done' | 'charged', message: string, charge: ChargeRecord | null = null): void {
    this.change({
      status,
      charge,
      settle: { attempts: this.nextAttempt, retryAt: null, message },
      checkAt: null,
      claimedAt: null,
    });
  }

  private stop(message: string): void {
    this.change({
      status: 'error',
      settle: { attempts: this.nextAttempt, retryAt: null, message },
      checkAt: null,
      claimedAt: null,
    });
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
