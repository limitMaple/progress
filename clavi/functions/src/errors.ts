// 入力の誤りと、その受け取り方。Web アプリからも import するので、Node に依存しないこと。

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

/**
 * fn を呼ぶ。入力の誤り（InvalidInputError）を投げたら、その文を error にして返す。
 * 確かめ方は functions/src の各クラスと同じものを使い、入力欄で別に書かない。ほかの例外はそのまま投げる。
 */
export function checkInput<T>(fn: () => T): { value: T; error: '' } | { value: null; error: string } {
  try {
    return { value: fn(), error: '' };
  } catch (err) {
    if (err instanceof InvalidInputError) return { value: null, error: err.message };
    throw err;
  }
}
