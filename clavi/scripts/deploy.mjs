// firebase deploy を呼ぶだけのスクリプト。直接コマンドを打たずにこれを使う理由は 2 つ。
//   - PowerShell は --only の "a,b,c" を分解してしまい、targets を見失う
//   - 関数の読み取り（discovery）が既定の 10 秒で切れることがあるので、時間を延ばす
// 使い方: npm run deploy            … hosting, functions, firestore
//         npm run deploy functions  … 対象を絞る
//         npm run deploy functions --debug … そのまま firebase に渡る

import { spawn } from "node:child_process";

const [target = "hosting,functions,firestore", ...rest] = process.argv.slice(2);

const child = spawn("firebase", ["deploy", "--only", target, ...rest], {
    stdio: "inherit",
    shell: true,
    env: {
        FUNCTIONS_DISCOVERY_TIMEOUT: "120",
        ...process.env, // 外から渡した値の方を優先する（調べるときに既定の 10 秒へ戻せるように）
    },
});
child.on("exit", (code) => process.exit(code ?? 1));
