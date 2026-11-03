// Firestore に置く形（model.ts）を、そのままプロパティとして持つクラスの土台。
// Web アプリからも import するので、Node に依存しないこと。

/** data の項目を、そのままプロパティとして持つクラスの土台（項目を 2 か所に書かないため）。 */
export function recordClass<T extends object>() {
  return class {
    constructor(data: T) {
      Object.assign(this, data);
    }
  } as new (data: T) => T;
}
