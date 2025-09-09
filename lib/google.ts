import { decryptAesGcm, encryptAesGcm } from "./crypto";
import { nowIso } from "./util";

export type GoogleTokens = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
};

async function fetchToken(env: Env, params: Record<string,string>) {
  const body = new URLSearchParams(params);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type':'application/x-www-form-urlencoded'},
    body
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json<GoogleTokens>();
}

export async function exchangeAuthCodeForTokens(code: string, redirectUri: string, env: Env) {
  return fetchToken(env, {
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
}

export async function refreshAccessToken(refreshToken: string, env: Env) {
  return fetchToken(env, {
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });
}

async function storeTokens(userId: string, tokens: GoogleTokens, env: Env) {
  const now = Math.floor(Date.now()/1000);
  const accessExpiry = now + (tokens.expires_in ?? 3600) - 60;
  const { ct: atEnc, iv: atIv } = await encryptAesGcm(tokens.access_token, env.MASTER_ENCRYPTION_KEY);
  let rtEnc = null, rtIv = null;
  if (tokens.refresh_token) {
    const enc = await encryptAesGcm(tokens.refresh_token, env.MASTER_ENCRYPTION_KEY);
    rtEnc = enc.ct; rtIv = enc.iv;
  }
  await env.DB.prepare(`
    INSERT INTO users (id, google_access_token_enc, google_access_iv, google_access_expiry, google_refresh_token_enc, google_refresh_iv, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, COALESCE(?5, google_refresh_token_enc), COALESCE(?6, google_refresh_iv), ?7, ?7)
    ON CONFLICT(id) DO UPDATE SET
      google_access_token_enc=excluded.google_access_token_enc,
      google_access_iv=excluded.google_access_iv,
      google_access_expiry=excluded.google_access_expiry,
      google_refresh_token_enc=COALESCE(excluded.google_refresh_token_enc, users.google_refresh_token_enc),
      google_refresh_iv=COALESCE(excluded.google_refresh_iv, users.google_refresh_iv),
      updated_at=excluded.updated_at
  `).bind(userId, atEnc, atIv, accessExpiry, rtEnc, rtIv, nowIso()).run();
}

export async function upsertUserIdentity(userId: string, email: string, name: string | undefined, env: Env) {
  await env.DB.prepare(`
    INSERT INTO users (id, email, name, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?4)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, updated_at=excluded.updated_at
  `).bind(userId, email, name || null, nowIso()).run();
}

export async function getUser(env: Env, userId: string) {
  const row = await env.DB.prepare('SELECT * FROM users WHERE id=?1').bind(userId).first();
  return row || null;
}

export async function ensureAccessToken(env: Env, userId: string): Promise<string> {
  const row = await getUser(env, userId);
  if (!row) throw new Error('User not found');
  const now = Math.floor(Date.now()/1000);
  let access = row.google_access_token_enc ? await decryptAesGcm(row.google_access_token_enc, row.google_access_iv, env.MASTER_ENCRYPTION_KEY) : null;
  if (!access || row.google_access_expiry < now) {
    const refresh = row.google_refresh_token_enc ? await decryptAesGcm(row.google_refresh_token_enc, row.google_refresh_iv, env.MASTER_ENCRYPTION_KEY) : null;
    if (!refresh) throw new Error('Missing refresh token');
    const tokens = await refreshAccessToken(refresh, env);
    await storeTokens(row.id, { ...tokens, refresh_token: refresh }, env);
    access = tokens.access_token;
  }
  return access!;
}

export async function googleFetch(env: Env, userId: string, url: string, init: RequestInit = {}) {
  const access = await ensureAccessToken(env, userId);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Authorization': `Bearer ${access}`,
      'Content-Type': (init as any).body ? 'application/json' : (init.headers as any)?.['Content-Type'] || undefined
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google API ${res.status}: ${txt}`);
  }
  return res;
}

export async function getUserInfo(accessToken: string) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('Failed userinfo');
  return res.json<{ sub: string; email: string; name?: string }>();
}

export async function ensurePreferences(env: Env, userId: string) {
  const p = await env.DB.prepare('SELECT * FROM preferences WHERE user_id=?1').bind(userId).first();
  if (p) return p;
  await env.DB.prepare(`
    INSERT INTO preferences (user_id, created_at, updated_at) VALUES (?1, ?2, ?2)
  `).bind(userId, nowIso()).run();
  return await env.DB.prepare('SELECT * FROM preferences WHERE user_id=?1').bind(userId).first();
}

export async function listTaskLists(env: Env, userId: string) {
  const res = await googleFetch(env, userId, 'https://tasks.googleapis.com/tasks/v1/users/@me/lists');
  const data = await res.json<any>();
  return data.items || [];
}
export async function listIncompleteTasks(env: Env, userId: string, listIds?: string[]) {
  const lists = listIds && listIds.length ? listIds : (await listTaskLists(env, userId)).map((l:any)=>l.id);
  const tasks: any[] = [];
  for (const id of lists) {
    const res = await googleFetch(env, userId, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(id)}/tasks?showCompleted=false&showDeleted=false`);
    const data = await res.json<any>();
    if (data.items) {
      for (const t of data.items) {
        if (t.status !== 'completed') tasks.push({ ...t, listId: id });
      }
    }
  }
  return tasks;
}

export async function listSelectedCalendars(env: Env, userId: string) {
  const res = await googleFetch(env, userId, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader');
  const data = await res.json<any>();
  const items = (data.items || []).filter((c:any)=>c.selected);
  return items;
}

export async function getTimezone(env: Env, userId: string) {
  const res = await googleFetch(env, userId, 'https://www.googleapis.com/calendar/v3/users/me/settings/timezone');
  const data = await res.json<any>();
  return data.value || 'UTC';
}

export async function ensureFocusCalendar(env: Env, userId: string): Promise<string> {
  let pref = await ensurePreferences(env, userId);
  if (pref.calendar_id) return pref.calendar_id;
  const res = await googleFetch(env, userId, 'https://www.googleapis.com/calendar/v3/users/me/calendarList');
  const list = await res.json<any>();
  const found = (list.items || []).find((c:any) => c.summary === 'CalWeaver Focus');
  let calId: string;
  if (found) {
    calId = found.id;
  } else {
    const create = await googleFetch(env, userId, 'https://www.googleapis.com/calendar/v3/calendars', {
      method: 'POST',
      body: JSON.stringify({ summary: 'CalWeaver Focus' })
    });
    const created = await create.json<any>();
    calId = created.id;
  }
  await env.DB.prepare('UPDATE preferences SET calendar_id=?1, updated_at=?2 WHERE user_id=?3')
    .bind(calId, nowIso(), userId).run();
  return calId;
}

export async function freeBusy(env: Env, userId: string, timeMin: string, timeMax: string, calendars: string[]) {
  const body = {
    timeMin, timeMax,
    items: calendars.map(id => ({ id }))
  };
  const res = await googleFetch(env, userId, 'https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const data = await res.json<any>();
  const busy: Array<{ start: Date; end: Date }> = [];
  for (const id of calendars) {
    const cal = data.calendars[id];
    if (cal && cal.busy) {
      for (const b of cal.busy) busy.push({ start: new Date(b.start), end: new Date(b.end) });
    }
  }
  busy.sort((a,b)=>a.start.getTime() - b.start.getTime());
  return busy;
}

export async function listEvents(env: Env, userId: string, calendarId: string, timeMin: string, timeMax: string) {
  const res = await googleFetch(env, userId, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
  const data = await res.json<any>();
  return data.items || [];
}

export async function insertEvent(env: Env, userId: string, calendarId: string, event: any) {
  const res = await googleFetch(env, userId, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(event)
  });
  return res.json<any>();
}

export async function deleteEvent(env: Env, userId: string, calendarId: string, eventId: string) {
  await googleFetch(env, userId, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
}

export type Env = import('./session').Env;
