import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";

// Web アプリの設定値はブラウザに配られる公開情報なので、ビルド時の環境変数にせずそのまま書く
// （守りたいものは Firestore のルールと Functions の認証で守る）
const firebaseConfig = {
    apiKey: "AIzaSyD1IhuYbNdzetAvGhw-8VuK5a0SFrPo-Bs",
    authDomain: "remotemaple-51048.firebaseapp.com",
    projectId: "remotemaple-51048",
    storageBucket: "remotemaple-51048.firebasestorage.app",
    messagingSenderId: "1032498603245",
    appId: "1:1032498603245:web:e233b8ba1b2d89076298e4",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

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
export function callFunction<Req, Res>(name: string) {
    const fn = httpsCallable<Req, Res>(functions, name);
    return async (data: Req) => (await fn(data)).data;
}
