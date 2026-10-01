import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";
import type {
    LastInput, SaveSettingsRequest, SaveSettingsResponse, SettleNowRequest, SettleResult,
    StartSessionRequest, StartSessionResponse, SyncNowResponse,
} from "@/functions/src/model";

// 設定値はコードに書かず、ビルド時の環境変数から読む。
// 手元は clavi/.env.local（git には入れない。項目は .env.example）、CI は GitHub の Secrets から渡す。
// NEXT_PUBLIC_ の値はビルド時に JS へ埋め込まれるので、process.env.XXX と 1 つずつ書く必要がある。
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// 値が欠けたままビルドすると、壊れた画面がそのまま公開されてしまうので、ビルドの時点で止める
const missing = Object.entries(firebaseConfig).filter(([, value]) => !value).map(([key]) => key);
if (missing.length) {
    throw new Error(`Firebase の設定値がありません: ${missing.join(", ")}（clavi/.env.local か CI の Secrets を確認）`);
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);

const functions = getFunctions(app, "asia-northeast1");

// `npm run dev` のときは本番ではなくローカルのエミュレーター（`npm run emulators`）につなぐ
// ページと同じホスト名にしないと、ポップアップのログインが「No matching frame」で失敗する
if (process.env.NODE_ENV === "development" && !auth.emulatorConfig) {
    const host = typeof window === "undefined" ? "127.0.0.1" : window.location.hostname;
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectFunctionsEmulator(functions, host, 5001);
}

/** Cloud Functions の呼び出し。失敗時は Functions 側のメッセージを持った Error を投げる。 */
function callFunction<Req, Res>(name: string) {
    const fn = httpsCallable<Req, Res>(functions, name);
    return async (data: Req) => (await fn(data)).data;
}

// 画面から呼ぶ関数。名前と型は functions/index.ts の export と functions/src/model.ts に合わせる
export const saveSettings = callFunction<SaveSettingsRequest, SaveSettingsResponse>("saveSettings");
export const startSession = callFunction<StartSessionRequest, StartSessionResponse>("startSession");
export const syncNow = callFunction<void, SyncNowResponse>("syncNow");
export const settleNow = callFunction<SettleNowRequest, SettleResult>("settleNow");
export const saveLastInput = callFunction<LastInput, void>("saveLastInput");
