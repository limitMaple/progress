# Toggl Ratchet

「○○までに△時間△分やる」と決めて、Toggl の記録で判定する Web アプリです。
締切までに作業時間へ届かなければ、Beeminder の課金 API で自分に課金します。

Chrome 拡張版を Firebase に移したものです。拡張版と違い、締切の判定はサーバー
（Cloud Functions）で行うので、PC やブラウザを閉じていても動きます。

## 使い方

1. Googleでログインする
2. ⚙ の設定で、Toggl と Beeminder の API トークンを入れて保存する
   - Toggl … [プロフィール](https://track.toggl.com/profile) の「API Token」
   - Beeminder … ログインした状態で [auth_token.json](https://www.beeminder.com/api/v1/auth_token.json) を開く
   - はじめは「テストモード」が有効で、実際には課金されません（Beeminder の `dryrun`）
3. 「新しいセッション」でタグ・締切・作業時間・金額を入れて「開始」
   - タグを空欄にすると、すべての Toggl 記録を数えます
4. Toggl のタイマーは自分で操作する
5. 「↻ 更新」で進捗を確認する（作業時間に達していればその場で「達成」になる）
6. 締切の30秒後、サーバーが自動で精算する
   - 達成 … 課金なし
   - 未達 … 賭けた額を Beeminder で課金（`POST /charges`）
   - 失敗 … 1分おきに最大3回まで再試行し、それでもだめなら「要確認」。画面の「精算する」で再実行できる

進捗は締切までの記録しか数えないので、締切を過ぎてから作業しても達成にはなりません。

## 構成

- `app/`, `components/` … 画面（Next.js の静的書き出し、Firebase Hosting に置く）
- `functions/` … Cloud Functions
  - `index.js` … 画面から呼ぶ関数（設定の保存・開始・更新・精算）と、1分おきの自動精算
  - `src/api.js` … Toggl / Beeminder の薄いクライアント
  - `src/progress.js` … 進捗計算と表示の純粋関数（拡張版から流用、テストあり）
  - `src/sync.js` … Toggl の記録で進捗を更新する
  - `src/settle.js` … 締切後の精算（課金するのはここだけ）
  - `src/store.js` … Firestore の読み書きと、二重課金を防ぐロック
- Firestore
  - `users/{uid}` … 設定（本人も読める）
  - `secrets/{uid}` … API トークン（Functions からしか読めない）
  - `users/{uid}/sessions/{id}` … セッション

## 開発

```
npm run emulators   # Firebase エミュレーター（別のターミナルで動かしておく）
npm run dev         # http://localhost:3000 。開発時はエミュレーターにつながる
npm --prefix functions test
```

エミュレーターでも Toggl と Beeminder は本物の API を呼びます。課金したくないときは
設定の「テストモード」を有効にしておいてください。

## デプロイ

```
npm run deploy      # ビルドして hosting, functions, firestore をまとめて反映
```

`main` に push すると GitHub Actions が Hosting だけを更新します。Functions と Firestore の
ルールは `npm run deploy`（または `firebase deploy --only functions,firestore`）が必要です。

## 制限

- Toggl の `/me` 系 API は 1 時間あたり 30 回まで（更新 1 回で 1 回、設定の保存で 2 回使います）
- 開始より 24 時間以上前から計測し続けている記録は数えられません
- 自動精算は1分おきの定期実行なので、締切から実際の課金まで最大1分ほどずれます
