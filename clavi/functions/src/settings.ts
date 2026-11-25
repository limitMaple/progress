// 設定の保存。API トークンを保存し、Toggl / Beeminder につないで、選択肢（プロジェクト・タグ）と課金先を取り直す。

import { beeminderClient, togglClient } from './api.ts';
import { isCancelMinutes } from './cancel.ts';
import { InvalidInputError } from './errors.ts';
import { hasUnsettledSession, loadAccount, secretRef, userRef } from './store.ts';
import type { Settings, Tokens } from './model.ts';
import type { SaveSettingsResponse } from './requests.ts';

// 未精算のセッションがある間は変えられない設定（走っている約束の条件を、あとから緩められないようにする）
const LOCKED_MESSAGE = '進行中か精算待ちのセッションがある間は、APIトークンと取り消し猶予は変えられません';

/** 変えたい設定。どの項目も、無ければ変えない。 */
export interface SettingsChange {
  /** 空欄のトークンは入れない */
  tokens: Partial<Tokens>;
  cancelMinutes: number | null;
}

/** 1 つのサービスにつないだ結果。 */
interface Connection {
  /** 取り直して保存する設定 */
  settings: Partial<Settings>;
  /** 画面に出す 1 行 */
  line: string;
}

/** Toggl につなぎ、選択肢（進行中のプロジェクトとタグ）を取り直す。 */
async function connectToggl(token: string): Promise<Connection> {
  const toggl = togglClient(token);
  const [me, tags, projects] = await Promise.all([toggl.me(), toggl.tags(), toggl.projects()]);
  const tagNames = [...new Set((tags ?? []).map((t) => t.name))].sort();
  // 選択肢には進行中のものだけ出す（アーカイブしたプロジェクトは選べなくてよい）
  const active = (projects ?? [])
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return {
    settings: { tags: tagNames, projects: active },
    line: `Toggl: 接続OK（${me.fullname || me.email}）。プロジェクト${active.length}件、タグ${tagNames.length}件を取得しました。`,
  };
}

/** Beeminder につなぎ、課金に要る user_id を控える。 */
async function connectBeeminder(token: string): Promise<Connection> {
  const me = await beeminderClient(token).me();
  return { settings: { beeminderUser: me.username }, line: `Beeminder: 接続OK（${me.username}）` };
}

/**
 * 設定を保存して、各サービスにつながるか確かめる。
 * 約束の条件になる設定（トークンと取り消し猶予）は、未精算のセッションがある間は変えられない。
 * 同じ値なら変更ではないので、ロック中でも保存できる（プロジェクトとタグの取り直しに使う）。
 */
export async function saveSettings(uid: string, change: SettingsChange): Promise<SaveSettingsResponse> {
  const { cancelMinutes } = change;
  if (cancelMinutes != null && !isCancelMinutes(cancelMinutes)) {
    throw new InvalidInputError('取り消し猶予は、0以上の分で入力してください');
  }
  const { settings: saved, tokens: savedTokens } = await loadAccount(uid);
  const changesTokens = Object.keys(change.tokens).length > 0;
  const changing = changesTokens || (cancelMinutes != null && cancelMinutes !== saved.cancelMinutes);
  if (changing && await hasUnsettledSession(uid)) throw new InvalidInputError(LOCKED_MESSAGE);

  if (changesTokens) await secretRef(uid).set(change.tokens, { merge: true });
  const tokens = { ...savedTokens, ...change.tokens };

  const settings: Partial<Settings> = {
    hasTogglToken: Boolean(tokens.togglToken),
    hasBeeminderToken: Boolean(tokens.beeminderToken),
    ...(cancelMinutes != null && { cancelMinutes }),
  };
  const lines = ['保存しました。'];
  let ok = true;
  const connections = [
    tokens.togglToken && (() => connectToggl(tokens.togglToken)),
    tokens.beeminderToken && (() => connectBeeminder(tokens.beeminderToken)),
  ];
  for (const connect of connections) {
    if (!connect) continue;
    try {
      const result = await connect();
      Object.assign(settings, result.settings);
      lines.push(result.line);
    } catch (err) {
      // つながらなくても、ほかのサービスの結果とトークンは保存する
      ok = false;
      lines.push((err as Error).message);
    }
  }

  await userRef(uid).set(settings, { merge: true });
  return { ok, message: lines.join('\n') };
}
