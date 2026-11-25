// セッション（「締切までに指定の時間やる」という 1 件の約束）の振る舞い。
// 保存する形は model.ts の SessionData。Web アプリからも import するので、Node に依存しないこと。
//
// 状態を変えるメソッド（「状態の移り変わり」の節）は自身を書き換え、変えた項目を覚えておく。
// 保存は store.ts の saveChanges で、変わった項目だけを update する（同時に動くほかの処理の書き込みを潰さない）。
// 画面は状態を調べるメソッド（isSettled, isCancelable など）だけを使い、状態を変えるメソッドは呼ばないこと
// （React の state を書き換えてしまう）。画面に出す形にするのは sessionView.ts。

import { formatDuration, sessionTitle } from './format.ts';
import { trackedSeconds } from './progress.ts';
import { recordClass } from './record.ts';
import { InvalidInputError } from './errors.ts';
import { MAX_START_PAST_MS, UNSETTLED_STATUSES } from './model.ts';
import type { ChargeRecord, SessionData, TogglProject } from './model.ts';
import type { TimeEntry } from './api.ts';

// 締切ちょうどの記録も拾えるよう、少しだけ待ってから精算する
const SETTLE_DELAY = 30 * 1000;
// 精算が重なって二重に課金しないよう、取りかかったセッションはこの間ロックする
const CLAIM_TTL = 5 * 60 * 1000;
// 課金の前に失敗したときの再試行
const RETRY_DELAY = 60 * 1000;
const MAX_ATTEMPTS = 3;

/** 手で始めるセッションの、約束の中身。 */
export interface StartSessionInput {
  requiredSec: number;
  /** 数え始める時刻。null なら始めた時刻から */
  startAt: number | null;
  due: number;
  dollars: number;
}

/**
 * 手で始めるセッションの中身が正しいかを確かめ、正しくなければ InvalidInputError を投げる。
 * Functions（startSession）と入力欄が同じものを使い、確かめ方と文をそろえる。
 */
export function validateStartSessionInput({ requiredSec, startAt, due, dollars }: StartSessionInput, now: number): void {
  const countFrom = startAt ?? now;
  if (!(due > now)) throw new InvalidInputError('締切が過ぎています');
  if (!(countFrom >= now - MAX_START_PAST_MS)) throw new InvalidInputError('カウント開始は30日前までにしてください');
  if (!(requiredSec > 0)) throw new InvalidInputError('作業時間を入力してください');
  if (!(dollars >= 1)) throw new InvalidInputError('金額は$1以上にしてください');
  if (!(due - countFrom >= requiredSec * 1000)) {
    throw new InvalidInputError(`カウント開始から締切まで${formatDuration((due - countFrom) / 1000)}しかありません`);
  }
}

export class Session extends recordClass<SessionData>() {
  // # の項目は列挙されないので、Firestore に保存する項目（{ ...session }）には入らない
  #changes: Partial<SessionData> = {};

  /** 新しく始めるセッション。now は作成時刻。 */
  static start({ id, now, project, tag, requiredSec, startAt, due, dollars, scheduleId = null, cancelableUntil = null }: {
    id: string;
    now: number;
    project: TogglProject | null;
    tag: string;
    requiredSec: number;
    startAt: number;
    due: number;
    dollars: number;
    /** スケジュールから作るときだけ */
    scheduleId?: string | null;
    /** この時刻より前なら取り消せる。null なら取り消せない */
    cancelableUntil?: number | null;
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
      scheduleId,
      cancelableUntil,
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

  /** 精算が済んでいる（達成か課金済み）か、取り消した。一覧から消せるのはこれだけ。 */
  get isSettled(): boolean {
    return !UNSETTLED_STATUSES.includes(this.status);
  }

  /** 取り消せるか。進行中で、取り消せる期限より前だけ。 */
  isCancelable(now: number): boolean {
    return this.status === 'active' && this.cancelableUntil != null && now < this.cancelableUntil;
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
    if (this.isSettled) return false;
    if (this.chargeRequestedAt && !resolving) return false;
    return !(this.claimedAt && now - this.claimedAt < CLAIM_TTL);
  }

  // ---- 状態の移り変わり（自身を書き換える。保存は saveChanges） ----

  /** 取り消す。精算も課金もしない。取り消せるかは isCancelable で確かめてから。 */
  cancel(now: number): void {
    if (!this.isCancelable(now)) throw new Error('取り消せる期限を過ぎているので、取り消せません');
    this.change({ status: 'canceled', checkAt: null, updatedAt: now });
  }

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
      `届きませんでした（${formatDuration(trackedSec)} / ${formatDuration(this.requiredSec)}）。$${this.dollars}を課金しました。`,
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
   * 結果が出たあとで、その保存に失敗したのなら何もしない（残っている結果を保存し直せばよい）。
   */
  retryLater(error: string, now: number): void {
    if (this.isSettled) return;
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

  /**
   * 課金 API の途中で失敗した。課金されたか分からないので、人が確かめるまで止める。
   * 課金できたあとで、その記録の保存に失敗したのなら何もしない（残っている記録を保存し直せばよい）。
   */
  stopForReview(error: string): void {
    if (this.isSettled) return;
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
}
