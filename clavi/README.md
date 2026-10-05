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
   - 保存すると Toggl のプロジェクトとタグの一覧を取り直します（Toggl で増やしたときは、トークンを空欄のまま保存する）
3. 「新しいセッション」でプロジェクト・タグ・カウント開始・締切・作業時間・金額を入れて「内容を確認する」
   - プロジェクトとタグの両方を指定すると、両方を満たす記録だけを数えます。どちらも空欄なら、すべての Toggl 記録を数えます
   - カウント開始は、Toggl の記録を数え始める日時です。空欄なら開始した時刻から、日付だけならその日の 0:00 から。過去は30日前まで
   - 締切は日付と時刻の両方を入れます
   - 入力欄は、最後に入力した値を覚えています
   - 確認画面でカウント開始・締切と内容を確かめて「この内容で開始」。**開始したあとは変更できません**
4. Toggl のタイマーは自分で操作する
5. 「↻ 更新」で進捗を確認する（作業時間に達していればその場で「達成」になる）
6. 締切の30秒後、サーバーが自動で精算する
   - 達成 … 課金なし
   - 未達 … 賭けた額を Beeminder で課金（`POST /charges`）
   - 課金の前に失敗 … 1分おきに最大3回まで再試行し、それでもだめなら「要確認」。画面の「精算する」で再実行できる
   - 課金 API の途中で失敗 … 課金されたか分からないので、自動では課金し直さず「要確認」で止まる。
     Beeminder の課金履歴を確かめて、画面で「課金されていた / されていなかった」を選ぶ

進捗はカウント開始から締切までの記録しか数えないので、締切を過ぎてから作業しても達成にはなりません。

## 構成

- `app/`, `components/` … 画面（Next.js の静的書き出し、Firebase Hosting に置く）
  - ログインとログアウトは `components/AuthGate.tsx` だけで扱い、`app/layout.tsx` で全ページを包む
- `lib/` … 画面側の Firebase への接続、画面から呼ぶ関数の定義、データの読み込み
- `functions/` … Cloud Functions（TypeScript。`tsc` で `lib/` に書き出し、デプロイ前に自動でビルドされる）
  - `index.ts` … 画面から呼ぶ関数（設定の保存・開始・更新・精算・入力欄の値の保存）と、1分おきの自動精算
  - `src/model.ts` … Firestore のデータの形と、画面から呼ぶ関数の引数・戻り値。画面側もここを import する
  - `src/api.ts` … Toggl / Beeminder の薄いクライアント
  - `src/progress.ts` … 進捗計算と表示の純粋関数（拡張版から流用。画面側も使う）
  - `src/sync.ts` … Toggl の記録で進捗を更新する
  - `src/settle.ts` … 締切後の精算（課金するのはここだけ）
  - `src/store.ts` … Firestore の読み書きと、二重課金を防ぐロック
- Firestore
  - `users/{uid}` … 設定（本人も読める）
  - `secrets/{uid}` … API トークン（Functions からしか読めない）
  - `users/{uid}/sessions/{id}` … セッション

## 開発

はじめに `.env.example` を `.env.local` に写して、Firebase の Web アプリ設定の値を入れます
（`.env.local` は git に入れない）。値が欠けているとビルドが止まります。

```
npm run emulators   # Firebase エミュレーター（別のターミナルで動かしておく）
npm run dev         # http://localhost:3000 。開発時はエミュレーターにつながる
npm test            # Functions のテスト（Firestore エミュレーターを立てて動かす。外部 API は呼ばない）
```

Functions を書き換えたら、エミュレーターに反映するには `npm --prefix functions run build` が要ります。

エミュレーターでも Toggl と Beeminder は本物の API を呼びます。エミュレーターで未達のセッションを
締切まで放置すると、本当に課金されるので注意してください。

## デプロイ

```
npm run deploy      # ビルドして hosting, functions, firestore をまとめて反映
```

`main` に push すると GitHub Actions が Hosting だけを更新します。Functions と Firestore の
ルールは `npm run deploy`（対象を絞るなら `npm run deploy functions`）が必要です。
`firebase deploy --only a,b` を PowerShell で直接打つと、カンマ区切りが壊れて対象を見失います。

GitHub Actions のビルドには、`.env.example` と同じ名前の値をリポジトリの Secrets に入れておく必要があります
（`gh secret set -f .env.local` でまとめて入る）。

## 制限

- Toggl の `/me` 系 API は 1 時間あたり 30 回まで（更新 1 回で 1 回、設定の保存で 3 回使います）
- カウント開始より 24 時間以上前から計測し続けている記録は数えられません
- 自動精算は1分おきの定期実行なので、締切から実際の課金まで最大1分ほどずれます
