// 入力の誤り。Web アプリからも import するので、Node に依存しないこと。

/**
 * 画面から来た値（か、画面で入力中の値）が正しくない。message はそのまま画面に出せる文にする。
 * Functions はこれを invalid-argument として返し、画面は入力欄の下に出す。
 */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}
