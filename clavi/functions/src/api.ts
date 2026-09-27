// Toggl Track API v9 と Beeminder API v1 の薄いクライアント。
// トークンを外に出さないため、呼ぶのは Cloud Functions だけ。

import type { TimeEntry } from './model.js';

const TOGGL_BASE = 'https://api.track.toggl.com/api/v9';
const BEEMINDER_BASE = 'https://www.beeminder.com/api/v1';

type Service = 'Toggl' | 'Beeminder';

export class ApiError extends Error {
  readonly service: Service;
  /** 通信自体に失敗したときは 0 */
  readonly status: number;

  constructor(service: Service, status: number, detail: string) {
    super(`${service}: ${detail}${status ? ` (HTTP ${status})` : ''}`);
    this.service = service;
    this.status = status;
  }
}

async function send<T>(service: Service, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError(service, 0, `通信に失敗しました（${(err as Error).message}）`);
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (res.ok) return body as T;

  let detail = typeof body === 'string' ? body : errorMessageOf(body);
  if (res.status === 402 && service === 'Toggl') {
    // ヘッダーが読めない環境もあるので、無ければ時間は出さない
    const resetsIn = Number(res.headers.get('X-Toggl-Quota-Resets-In'));
    detail = 'APIの利用上限（1時間30回）に達しました'
      + (resetsIn ? `。約${Math.ceil(resetsIn / 60)}分後に回復します` : '');
  } else if (res.status === 429) {
    detail = 'リクエストが多すぎます。少し待ってから再試行してください';
  } else if (res.status === 401 || res.status === 403) {
    detail ||= 'APIトークンが正しくありません';
  }
  throw new ApiError(service, res.status, detail || 'エラーが発生しました');
}

/** エラーの本文からメッセージを取り出す。Beeminder は { errors: { message } } の形で返す。 */
function errorMessageOf(body: unknown): string {
  const b = body as { errors?: { message?: string }; error?: string; message?: string } | null;
  return b?.errors?.message ?? b?.error ?? b?.message ?? '';
}

// ---- Toggl ----

export interface TogglMe {
  fullname?: string;
  email: string;
}

export interface TogglTag {
  name: string;
}

export function togglClient(token: string) {
  const headers = { Authorization: `Basic ${btoa(`${token}:api_token`)}` };
  const get = <T>(path: string) => send<T>('Toggl', `${TOGGL_BASE}${path}`, { headers });
  return {
    me: () => get<TogglMe>('/me'),
    tags: () => get<TogglTag[] | null>('/me/tags'),
    /** start / end は RFC3339 文字列 */
    timeEntries: (start: string, end: string) => {
      const q = new URLSearchParams({ start_date: start, end_date: end });
      return get<TimeEntry[]>(`/me/time_entries?${q}`);
    },
  };
}

// ---- Beeminder ----

export interface BeeminderMe {
  username: string;
}

export interface BeeminderCharge {
  id: string;
  amount: number;
  note: string;
  username: string;
}

export function beeminderClient(token: string) {
  const call = <T>(method: 'GET' | 'POST', path: string, params: Record<string, string> = {}) => {
    const query = new URLSearchParams({ auth_token: token, ...params });
    return method === 'GET'
      ? send<T>('Beeminder', `${BEEMINDER_BASE}${path}?${query}`, {})
      : send<T>('Beeminder', `${BEEMINDER_BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: query,
      });
  };
  return {
    me: () => call<BeeminderMe>('GET', '/users/me.json'),
    /**
     * 自分に課金する。amount は米ドルで 1.00 以上。
     * dryrun を渡すと課金されず、結果の形だけが返る。
     */
    charge: ({ user, amount, note, dryrun }: {
      user: string;
      amount: number;
      note: string;
      dryrun: boolean;
    }) => call<BeeminderCharge>('POST', '/charges.json', {
      user_id: user,
      amount: String(amount),
      note,
      ...(dryrun ? { dryrun: 'true' } : {}),
    }),
  };
}
