// Toggl Track API v9 と Beeminder API v1 の薄いクライアント。
// トークンを外に出さないため、呼ぶのは Cloud Functions だけ。

import type { TimeEntry } from './model.ts';

const TOGGL_BASE = 'https://api.track.toggl.com/api/v9';
const BEEMINDER_BASE = 'https://www.beeminder.com/api/v1';

/** 「Toggl: APIトークンが正しくありません (HTTP 401)」の形のエラー。status は通信自体に失敗したときは 0。 */
function apiError(service: string, status: number, detail: string): Error {
  return new Error(`${service}: ${detail}${status ? ` (HTTP ${status})` : ''}`);
}

// 応答が来ないまま待ち続けて、精算のロックが切れるまで居座らないようにする
const TIMEOUT = 20 * 1000;

/** 通信して、レスポンスと本文（JSON として読めなければ文字列のまま）を返す。 */
async function request(service: string, url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    throw apiError(service, 0, `通信に失敗しました（${(err as Error).message}）`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
}

/**
 * 失敗したレスポンスのエラー文。本文にメッセージがあればそれを使い、無ければステータスから決める。
 * 本文は Beeminder なら { errors: { message } }、Toggl ならたいてい文字列。
 */
function errorDetail(status: number, body: unknown): string {
  const b = body as { errors?: { message?: string }; error?: string; message?: string } | null;
  const message = typeof body === 'string' ? body : b?.errors?.message ?? b?.error ?? b?.message ?? '';
  switch (status) {
    case 429:
      return 'リクエストが多すぎます。少し待ってから再試行してください';
    case 401:
    case 403:
      return message || 'APIトークンが正しくありません';
    default:
      return message || 'エラーが発生しました';
  }
}

// ---- Toggl ----

interface TogglMe {
  fullname?: string;
  email: string;
}

interface TogglTag {
  name: string;
}

interface TogglProjectEntry {
  id: number;
  name: string;
  active: boolean;
}

async function sendToggl<T>(token: string, path: string): Promise<T> {
  const { res, body } = await request('Toggl', `${TOGGL_BASE}${path}`, {
    headers: { Authorization: `Basic ${btoa(`${token}:api_token`)}` },
  });
  if (res.ok) return body as T;
  if (res.status === 402) {
    // ヘッダーが読めない環境もあるので、無ければ時間は出さない
    const resetsIn = Number(res.headers.get('X-Toggl-Quota-Resets-In'));
    throw apiError('Toggl', res.status, 'APIの利用上限（1時間30回）に達しました'
      + (resetsIn ? `。約${Math.ceil(resetsIn / 60)}分後に回復します` : ''));
  }
  throw apiError('Toggl', res.status, errorDetail(res.status, body));
}

export function togglClient(token: string) {
  const get = <T>(path: string) => sendToggl<T>(token, path);
  return {
    me: () => get<TogglMe>('/me'),
    tags: () => get<TogglTag[] | null>('/me/tags'),
    projects: () => get<TogglProjectEntry[] | null>('/me/projects'),
    /** start / end は RFC3339 文字列 */
    timeEntries: (start: string, end: string) => {
      const q = new URLSearchParams({ start_date: start, end_date: end });
      return get<TimeEntry[]>(`/me/time_entries?${q}`);
    },
  };
}

// ---- Beeminder ----

interface BeeminderMe {
  username: string;
}

interface BeeminderCharge {
  id: string;
  amount: number;
  note: string;
  username: string;
}

async function sendBeeminder<T>(
  token: string, method: 'GET' | 'POST', path: string, params: Record<string, string> = {},
): Promise<T> {
  const query = new URLSearchParams({ auth_token: token, ...params });
  const { res, body } = method === 'GET'
    ? await request('Beeminder', `${BEEMINDER_BASE}${path}?${query}`, {})
    : await request('Beeminder', `${BEEMINDER_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: query,
    });
  if (res.ok) return body as T;
  throw apiError('Beeminder', res.status, errorDetail(res.status, body));
}

export function beeminderClient(token: string) {
  return {
    me: () => sendBeeminder<BeeminderMe>(token, 'GET', '/users/me.json'),
    /** 自分に課金する。amount は米ドルで 1.00 以上。 */
    charge: ({ user, amount, note }: { user: string; amount: number; note: string }) =>
      sendBeeminder<BeeminderCharge>(token, 'POST', '/charges.json', { user_id: user, amount: String(amount), note }),
  };
}
