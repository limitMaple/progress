// Toggl Track API v9 と Beeminder API v1 の薄いクライアント。
// トークンを外に出さないため、呼ぶのは Cloud Functions だけ。

const TOGGL_BASE = 'https://api.track.toggl.com/api/v9';
const BEEMINDER_BASE = 'https://www.beeminder.com/api/v1';

export class ApiError extends Error {
  constructor(service, status, detail) {
    super(`${service}: ${detail}${status ? ` (HTTP ${status})` : ''}`);
    this.service = service;
    this.status = status;
  }
}

async function send(service, url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError(service, 0, `通信に失敗しました（${err.message}）`);
  }

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (res.ok) return body;

  // Beeminder は { errors: { message } } の形で返す
  let detail = typeof body === 'string'
    ? body
    : (body?.errors?.message ?? body?.error ?? body?.message ?? '');
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

export function togglClient(token) {
  const headers = { Authorization: `Basic ${btoa(`${token}:api_token`)}` };
  const get = (path) => send('Toggl', `${TOGGL_BASE}${path}`, { headers });
  return {
    me: () => get('/me'),
    tags: () => get('/me/tags'),
    /** start / end は RFC3339 文字列 */
    timeEntries: (start, end) => {
      const q = new URLSearchParams({ start_date: start, end_date: end });
      return get(`/me/time_entries?${q}`);
    },
  };
}

export function beeminderClient(token) {
  const call = (method, path, params = {}) => {
    const query = new URLSearchParams({ auth_token: token, ...params });
    return method === 'GET'
      ? send('Beeminder', `${BEEMINDER_BASE}${path}?${query}`, {})
      : send('Beeminder', `${BEEMINDER_BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: query,
      });
  };
  return {
    me: () => call('GET', '/users/me.json'),
    /**
     * 自分に課金する。amount は米ドルで 1.00 以上。
     * dryrun を渡すと課金されず、結果の形だけが返る。
     */
    charge: ({ user, amount, note, dryrun }) => call('POST', '/charges.json', {
      user_id: user,
      amount: String(amount),
      note,
      ...(dryrun ? { dryrun: 'true' } : {}),
    }),
  };
}
