var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../lib/session.ts
function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
__name(b64ToBytes, "b64ToBytes");
async function importHmacKey(b64) {
  return crypto.subtle.importKey("raw", b64ToBytes(b64), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
__name(importHmacKey, "importHmacKey");
async function hmac(b64Key, data) {
  const key = await importHmacKey(b64Key);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const arr = new Uint8Array(sig);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
__name(hmac, "hmac");
async function setSession(userId, env) {
  const ts = Date.now().toString();
  const payload = `${userId}|${ts}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${payload}|${sig}`;
}
__name(setSession, "setSession");
async function getSessionUserId(req, env) {
  const cookie = req.headers.get("Cookie") || "";
  const m = /cw_session=([^;]+)/.exec(cookie);
  if (!m) return null;
  const val = decodeURIComponent(m[1]);
  const parts = val.split("|");
  if (parts.length !== 3) return null;
  const [userId, ts, sig] = parts;
  const expected = await hmac(env.SESSION_SECRET, `${userId}|${ts}`);
  if (sig !== expected) return null;
  return userId;
}
__name(getSessionUserId, "getSessionUserId");
function sessionCookieHeader(value) {
  const maxAge = 60 * 60 * 24 * 30;
  return `cw_session=${encodeURIComponent(value)}; HttpOnly; Secure; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}
__name(sessionCookieHeader, "sessionCookieHeader");

// ../lib/crypto.ts
function b64ToBytes2(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
__name(b64ToBytes2, "b64ToBytes");
function bytesToB64(bytes) {
  const arr = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}
__name(bytesToB64, "bytesToB64");
async function importAesKey(b64) {
  const keyBytes = b64ToBytes2(b64);
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
__name(importAesKey, "importAesKey");
async function encryptAesGcm(plain, base64Key) {
  const key = await importAesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  return { ct: bytesToB64(ct), iv: bytesToB64(iv) };
}
__name(encryptAesGcm, "encryptAesGcm");
async function decryptAesGcm(ctB64, ivB64, base64Key) {
  const key = await importAesKey(base64Key);
  const dec = new TextDecoder();
  const ct = b64ToBytes2(ctB64);
  const iv = b64ToBytes2(ivB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return dec.decode(pt);
}
__name(decryptAesGcm, "decryptAesGcm");

// ../lib/util.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(nowIso, "nowIso");
function genId(prefix = "id") {
  return `${prefix}_${crypto.randomUUID()}`;
}
__name(genId, "genId");

// ../lib/google.ts
async function fetchToken(env, params) {
  const body = new URLSearchParams(params);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}
__name(fetchToken, "fetchToken");
async function exchangeAuthCodeForTokens(code, redirectUri, env) {
  return fetchToken(env, {
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });
}
__name(exchangeAuthCodeForTokens, "exchangeAuthCodeForTokens");
async function refreshAccessToken(refreshToken, env) {
  return fetchToken(env, {
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token"
  });
}
__name(refreshAccessToken, "refreshAccessToken");
async function storeTokens(userId, tokens, env) {
  const now = Math.floor(Date.now() / 1e3);
  const accessExpiry = now + (tokens.expires_in ?? 3600) - 60;
  const { ct: atEnc, iv: atIv } = await encryptAesGcm(tokens.access_token, env.MASTER_ENCRYPTION_KEY);
  let rtEnc = null, rtIv = null;
  if (tokens.refresh_token) {
    const enc = await encryptAesGcm(tokens.refresh_token, env.MASTER_ENCRYPTION_KEY);
    rtEnc = enc.ct;
    rtIv = enc.iv;
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
__name(storeTokens, "storeTokens");
async function upsertUserIdentity(userId, email, name, env) {
  await env.DB.prepare(`
    INSERT INTO users (id, email, name, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?4)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, updated_at=excluded.updated_at
  `).bind(userId, email, name || null, nowIso()).run();
}
__name(upsertUserIdentity, "upsertUserIdentity");
async function getUser(env, userId) {
  const row = await env.DB.prepare("SELECT * FROM users WHERE id=?1").bind(userId).first();
  return row || null;
}
__name(getUser, "getUser");
async function ensureAccessToken(env, userId) {
  const row = await getUser(env, userId);
  if (!row) throw new Error("User not found");
  const now = Math.floor(Date.now() / 1e3);
  let access = row.google_access_token_enc ? await decryptAesGcm(row.google_access_token_enc, row.google_access_iv, env.MASTER_ENCRYPTION_KEY) : null;
  if (!access || row.google_access_expiry < now) {
    const refresh = row.google_refresh_token_enc ? await decryptAesGcm(row.google_refresh_token_enc, row.google_refresh_iv, env.MASTER_ENCRYPTION_KEY) : null;
    if (!refresh) throw new Error("Missing refresh token");
    const tokens = await refreshAccessToken(refresh, env);
    await storeTokens(row.id, { ...tokens, refresh_token: refresh }, env);
    access = tokens.access_token;
  }
  return access;
}
__name(ensureAccessToken, "ensureAccessToken");
async function googleFetch(env, userId, url, init = {}) {
  const access = await ensureAccessToken(env, userId);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init.headers || {},
      "Authorization": `Bearer ${access}`,
      "Content-Type": init.body ? "application/json" : init.headers?.["Content-Type"] || void 0
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Google API ${res.status}: ${txt}`);
  }
  return res;
}
__name(googleFetch, "googleFetch");
async function getUserInfo(accessToken) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { "Authorization": `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error("Failed userinfo");
  return res.json();
}
__name(getUserInfo, "getUserInfo");
async function ensurePreferences(env, userId) {
  const p = await env.DB.prepare("SELECT * FROM preferences WHERE user_id=?1").bind(userId).first();
  if (p) return p;
  await env.DB.prepare(`
    INSERT INTO preferences (user_id, created_at, updated_at) VALUES (?1, ?2, ?2)
  `).bind(userId, nowIso()).run();
  return await env.DB.prepare("SELECT * FROM preferences WHERE user_id=?1").bind(userId).first();
}
__name(ensurePreferences, "ensurePreferences");
async function listTaskLists(env, userId) {
  const res = await googleFetch(env, userId, "https://tasks.googleapis.com/tasks/v1/users/@me/lists");
  const data = await res.json();
  return data.items || [];
}
__name(listTaskLists, "listTaskLists");
async function listIncompleteTasks(env, userId, listIds) {
  const lists = listIds && listIds.length ? listIds : (await listTaskLists(env, userId)).map((l) => l.id);
  const tasks = [];
  for (const id of lists) {
    const res = await googleFetch(env, userId, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(id)}/tasks?showCompleted=false&showDeleted=false`);
    const data = await res.json();
    if (data.items) {
      for (const t of data.items) {
        if (t.status !== "completed") tasks.push({ ...t, listId: id });
      }
    }
  }
  return tasks;
}
__name(listIncompleteTasks, "listIncompleteTasks");
async function listSelectedCalendars(env, userId) {
  const res = await googleFetch(env, userId, "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader");
  const data = await res.json();
  const items = (data.items || []).filter((c) => c.selected);
  return items;
}
__name(listSelectedCalendars, "listSelectedCalendars");
async function getTimezone(env, userId) {
  const res = await googleFetch(env, userId, "https://www.googleapis.com/calendar/v3/users/me/settings/timezone");
  const data = await res.json();
  return data.value || "UTC";
}
__name(getTimezone, "getTimezone");
async function ensureFocusCalendar(env, userId) {
  let pref = await ensurePreferences(env, userId);
  if (pref.calendar_id) return pref.calendar_id;
  const res = await googleFetch(env, userId, "https://www.googleapis.com/calendar/v3/users/me/calendarList");
  const list = await res.json();
  const found = (list.items || []).find((c) => c.summary === "CalWeaver Focus");
  let calId;
  if (found) {
    calId = found.id;
  } else {
    const create = await googleFetch(env, userId, "https://www.googleapis.com/calendar/v3/calendars", {
      method: "POST",
      body: JSON.stringify({ summary: "CalWeaver Focus" })
    });
    const created = await create.json();
    calId = created.id;
  }
  await env.DB.prepare("UPDATE preferences SET calendar_id=?1, updated_at=?2 WHERE user_id=?3").bind(calId, nowIso(), userId).run();
  return calId;
}
__name(ensureFocusCalendar, "ensureFocusCalendar");
async function freeBusy(env, userId, timeMin, timeMax, calendars) {
  const body = {
    timeMin,
    timeMax,
    items: calendars.map((id) => ({ id }))
  };
  const res = await googleFetch(env, userId, "https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    body: JSON.stringify(body)
  });
  const data = await res.json();
  const busy = [];
  for (const id of calendars) {
    const cal = data.calendars[id];
    if (cal && cal.busy) {
      for (const b of cal.busy) busy.push({ start: new Date(b.start), end: new Date(b.end) });
    }
  }
  busy.sort((a, b) => a.start.getTime() - b.start.getTime());
  return busy;
}
__name(freeBusy, "freeBusy");
async function listEvents(env, userId, calendarId, timeMin, timeMax) {
  const res = await googleFetch(env, userId, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
  const data = await res.json();
  return data.items || [];
}
__name(listEvents, "listEvents");
async function insertEvent(env, userId, calendarId, event) {
  const res = await googleFetch(env, userId, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(event)
  });
  return res.json();
}
__name(insertEvent, "insertEvent");
async function deleteEvent(env, userId, calendarId, eventId) {
  await googleFetch(env, userId, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
}
__name(deleteEvent, "deleteEvent");

// oauth/google/callback.ts
var onRequestGet = /* @__PURE__ */ __name(async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookie = request.headers.get("Cookie") || "";
  const m = /oauth_state=([^;]+)/.exec(cookie);
  const cookieState = m ? decodeURIComponent(m[1]) : null;
  if (!code || !state || state !== cookieState) {
    return new Response("Invalid OAuth state", { status: 400 });
  }
  const redirectUri = new URL("/oauth/google/callback", url.origin).toString();
  const tokens = await exchangeAuthCodeForTokens(code, redirectUri, env);
  const userinfo = await getUserInfo(tokens.access_token);
  await upsertUserIdentity(userinfo.sub, userinfo.email, userinfo.name, env);
  const now = nowIso();
  const at = await encryptAesGcm(tokens.access_token, env.MASTER_ENCRYPTION_KEY);
  const rt = tokens.refresh_token ? await encryptAesGcm(tokens.refresh_token, env.MASTER_ENCRYPTION_KEY) : null;
  const accessExpiry = Math.floor(Date.now() / 1e3) + (tokens.expires_in || 3600) - 60;
  await env.DB.prepare(`
    INSERT INTO users (id, email, name, google_access_token_enc, google_access_iv, google_access_expiry, google_refresh_token_enc, google_refresh_iv, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, google_access_token_enc=excluded.google_access_token_enc, google_access_iv=excluded.google_access_iv, google_access_expiry=excluded.google_access_expiry, google_refresh_token_enc=COALESCE(excluded.google_refresh_token_enc, users.google_refresh_token_enc), google_refresh_iv=COALESCE(excluded.google_refresh_iv, users.google_refresh_iv), updated_at=excluded.updated_at
  `).bind(userinfo.sub, userinfo.email, userinfo.name || null, at.ct, at.iv, accessExpiry, rt?.ct || null, rt?.iv || null, now).run();
  try {
    const tz = await getTimezone(env, userinfo.sub);
    await env.DB.prepare("UPDATE users SET tz=?1, updated_at=?2 WHERE id=?3").bind(tz, now, userinfo.sub).run();
  } catch {
  }
  const sess = await setSession(userinfo.sub, env);
  return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": sessionCookieHeader(sess) } });
}, "onRequestGet");

// oauth/google/start.ts
var onRequestGet2 = /* @__PURE__ */ __name(async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const redirectUri = new URL("/oauth/google/callback", url.origin).toString();
  const state = crypto.randomUUID();
  const setState = `oauth_state=${state}; HttpOnly; Secure; Path=/; Max-Age=600; SameSite=Lax`;
  const scope = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/tasks.readonly",
    "https://www.googleapis.com/auth/calendar"
  ].join(" ");
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { Location: authUrl.toString(), "Set-Cookie": setState }
  });
}, "onRequestGet");

// api/byok.ts
var onRequestPost = /* @__PURE__ */ __name(async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const { key } = await request.json();
  if (!key || !/^sk-/.test(key)) return new Response("Invalid key", { status: 400 });
  const enc = await encryptAesGcm(key, env.MASTER_ENCRYPTION_KEY);
  await env.DB.prepare(`
    INSERT INTO openai_keys (user_id, key_enc, key_iv, created_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(user_id) DO UPDATE SET key_enc=excluded.key_enc, key_iv=excluded.key_iv
  `).bind(userId, enc.ct, enc.iv, nowIso()).run();
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}, "onRequestPost");
var onRequestDelete = /* @__PURE__ */ __name(async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  await env.DB.prepare("DELETE FROM openai_keys WHERE user_id=?1").bind(userId).run();
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}, "onRequestDelete");

// api/me.ts
var onRequestGet3 = /* @__PURE__ */ __name(async (context) => {
  const { request, env } = context;
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response(JSON.stringify({ connected: false }), { status: 200, headers: { "Content-Type": "application/json" } });
  const user = await getUser(env, userId);
  const byok = await env.DB.prepare("SELECT 1 FROM openai_keys WHERE user_id=?1").bind(userId).first();
  return new Response(JSON.stringify({
    connected: true,
    email: user?.email,
    tz: user?.tz,
    byok: !!byok
  }), { headers: { "Content-Type": "application/json" } });
}, "onRequestGet");

// api/preferences.ts
var onRequestGet4 = /* @__PURE__ */ __name(async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const pref = await ensurePreferences(env, userId);
  return new Response(JSON.stringify(pref), { headers: { "Content-Type": "application/json" } });
}, "onRequestGet");
var onRequestPost2 = /* @__PURE__ */ __name(async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const body = await request.json();
  const now = nowIso();
  await env.DB.prepare(`
    UPDATE preferences SET
      horizon_days=COALESCE(?1, horizon_days),
      working_start=COALESCE(?2, working_start),
      working_end=COALESCE(?3, working_end),
      min_block=COALESCE(?4, min_block),
      max_block=COALESCE(?5, max_block),
      buffer_minutes=COALESCE(?6, buffer_minutes),
      max_daily_focus=COALESCE(?7, max_daily_focus),
      updated_at=?8
    WHERE user_id=?9
  `).bind(
    body.horizon_days ?? null,
    body.working_start ?? null,
    body.working_end ?? null,
    body.min_block ?? null,
    body.max_block ?? null,
    body.buffer_minutes ?? null,
    body.max_daily_focus ?? null,
    now,
    userId
  ).run();
  const pref = await ensurePreferences(env, userId);
  return new Response(JSON.stringify(pref), { headers: { "Content-Type": "application/json" } });
}, "onRequestPost");

// ../lib/openai.ts
async function getOpenAIKey(env, userId) {
  const row = await env.DB.prepare("SELECT key_enc, key_iv FROM openai_keys WHERE user_id=?1").bind(userId).first();
  if (!row) return null;
  return await decryptAesGcm(row.key_enc, row.key_iv, env.MASTER_ENCRYPTION_KEY);
}
__name(getOpenAIKey, "getOpenAIKey");
async function estimateTasks(env, userId, tasks) {
  const key = await getOpenAIKey(env, userId);
  if (!key) throw new Error("No OpenAI key stored.");
  if (!tasks.length) return [];
  const truncated = tasks.slice(0, 50);
  const prompt = `
You estimate task attributes. For each task, output JSON object with:
{id, durationMinutes, chunkMinutes, priority}
Rules:
- durationMinutes \u2208 [15, 480]
- chunkMinutes \u2208 [15, 120]
- priority \u2208 [1 (low) .. 5 (high)]
- If due is near (within 48h), bump priority.
Here are tasks:
${truncated.map((t) => `- id:${t.id} title:${t.title} notes:${(t.notes || "").slice(0, 200)} due:${t.due || "none"}`).join("\n")}
Return ONLY an array of JSON objects.
  `.trim();
  const res = await fetch((env.OPENAI_API_BASE || "https://api.openai.com/v1") + "/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.DEFAULT_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: "You return concise, valid JSON only." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 800
    })
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || "[]";
  let jsonText = text.replace(/```json|```/g, "");
  let arr = [];
  try {
    arr = JSON.parse(jsonText);
  } catch {
    return truncated.map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes,
      due: t.due,
      durationMinutes: Math.min(240, Math.max(30, (t.title || "").length * 2)),
      chunkMinutes: 50,
      priority: 3
    }));
  }
  const map = new Map(truncated.map((t) => [t.id, t]));
  const clamp = /* @__PURE__ */ __name((v, min, max) => Math.max(min, Math.min(max, Math.round(v))), "clamp");
  return arr.map((o) => {
    const base = map.get(o.id);
    return {
      id: o.id,
      title: base?.title || "",
      notes: base?.notes,
      due: base?.due,
      durationMinutes: clamp(o.durationMinutes ?? 60, 15, 480),
      chunkMinutes: clamp(o.chunkMinutes ?? 50, 15, 120),
      priority: clamp(o.priority ?? 3, 1, 5)
    };
  });
}
__name(estimateTasks, "estimateTasks");

// ../lib/time.ts
function addMinutes(d, mins) {
  return new Date(d.getTime() + mins * 6e4);
}
__name(addMinutes, "addMinutes");

// ../lib/scheduler.ts
function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
  const out = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const prev = out[out.length - 1];
    const cur = intervals[i];
    if (cur.start <= prev.end) {
      if (cur.end > prev.end) prev.end = cur.end;
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}
__name(mergeIntervals, "mergeIntervals");
function subtractBusyFromWorkday(dayStart, dayEnd, busy) {
  const free = [];
  let cursor = new Date(dayStart);
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start > cursor) {
      free.push({ start: new Date(cursor), end: new Date(Math.min(b.start.getTime(), dayEnd.getTime())) });
    }
    cursor = new Date(Math.max(cursor.getTime(), b.end.getTime()));
    if (cursor >= dayEnd) break;
  }
  if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd });
  return free.filter((f) => f.end > f.start);
}
__name(subtractBusyFromWorkday, "subtractBusyFromWorkday");
function computeFreeSlots(horizonStart, horizonDays, tz, prefs, busyAll) {
  const result = [];
  const workdays = prefs.workdays || ["Mon", "Tue", "Wed", "Thu", "Fri"];
  for (let d = 0; d < horizonDays; d++) {
    const day = new Date(horizonStart.getTime() + d * 864e5);
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day.getDay()];
    if (!prefs.include_weekends && !workdays.includes(wd)) {
      result.push({ day, slots: [] });
      continue;
    }
    const [sh, sm] = (prefs.working_start || "09:00").split(":").map(Number);
    const [eh, em] = (prefs.working_end || "17:00").split(":").map(Number);
    const dayStart = new Date(day);
    dayStart.setHours(sh || 9, sm || 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(eh || 17, em || 0, 0, 0);
    const todaysBusy = busyAll.filter((b) => b.start < dayEnd && b.end > dayStart).map((b) => ({
      start: new Date(Math.max(b.start.getTime(), dayStart.getTime())),
      end: new Date(Math.min(b.end.getTime(), dayEnd.getTime()))
    }));
    const merged = mergeIntervals(todaysBusy);
    const free = subtractBusyFromWorkday(dayStart, dayEnd, merged);
    result.push({ day, slots: free });
  }
  return result;
}
__name(computeFreeSlots, "computeFreeSlots");
function planTasksIntoSlots(tasks, slotsByDay, prefs, tz) {
  const scored = tasks.map((t) => {
    let urgency = 0;
    if (t.due) {
      const due = new Date(t.due);
      urgency = Math.max(0, (7 * 864e5 - (due.getTime() - Date.now())) / 864e5);
    }
    return { t, score: t.priority * 10 + urgency };
  }).sort((a, b) => b.score - a.score).map((x) => x.t);
  const placements = [];
  const perDayFocusUsed = /* @__PURE__ */ new Map();
  for (const task of scored) {
    const total = task.durationMinutes;
    const chunk = Math.max(prefs.min_block, Math.min(prefs.max_block, task.chunkMinutes));
    let remain = total;
    let chunkIndex = 0;
    const chunkCount = Math.ceil(total / chunk);
    for (let dayIdx = 0; dayIdx < slotsByDay.length && remain > 0; dayIdx++) {
      const day = slotsByDay[dayIdx];
      const dayEpoch = new Date(day.day.getFullYear(), day.day.getMonth(), day.day.getDate()).getTime();
      const used = perDayFocusUsed.get(dayEpoch) || 0;
      const remainingCapacity = Math.max(0, prefs.max_daily_focus - used);
      if (remainingCapacity < prefs.min_block) continue;
      for (let sIdx = 0; sIdx < day.slots.length && remain > 0; sIdx++) {
        const slot = day.slots[sIdx];
        let cursor = new Date(slot.start);
        while (cursor < slot.end && remain > 0) {
          const already = perDayFocusUsed.get(dayEpoch) || 0;
          const thisChunk = Math.min(chunk, remain, prefs.max_daily_focus - already);
          if (thisChunk < prefs.min_block) break;
          const end = addMinutes(cursor, thisChunk);
          if (end > slot.end) break;
          placements.push({ taskId: task.id, start: new Date(cursor), end, chunkIndex: chunkIndex + 1, chunkCount });
          perDayFocusUsed.set(dayEpoch, already + thisChunk);
          remain -= thisChunk;
          chunkIndex++;
          cursor = end;
        }
      }
    }
  }
  return placements;
}
__name(planTasksIntoSlots, "planTasksIntoSlots");

// api/run.ts
var onRequestPost3 = /* @__PURE__ */ __name(async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const pref = await env.DB.prepare("SELECT * FROM preferences WHERE user_id=?1").bind(userId).first();
  const horizonDays = pref?.horizon_days ?? 7;
  const tz = (await env.DB.prepare("SELECT tz FROM users WHERE id=?1").bind(userId).first())?.tz || "UTC";
  const now = /* @__PURE__ */ new Date();
  const horizonStart = new Date(now);
  horizonStart.setHours(0, 0, 0, 0);
  const horizonEnd = new Date(horizonStart.getTime() + horizonDays * 864e5);
  const calId = await ensureFocusCalendar(env, userId);
  const events = await listEvents(env, userId, calId, horizonStart.toISOString(), horizonEnd.toISOString());
  for (const e of events) {
    await deleteEvent(env, userId, calId, e.id);
  }
  const calendars = (await listSelectedCalendars(env, userId)).map((c) => c.id).filter((id) => id !== calId);
  const busy = await freeBusy(env, userId, horizonStart.toISOString(), horizonEnd.toISOString(), calendars);
  const buffer = pref?.buffer_minutes ?? 10;
  const busyBuffered = busy.map((b) => ({
    start: new Date(b.start.getTime() - buffer * 6e4),
    end: new Date(b.end.getTime() + buffer * 6e4)
  }));
  const tasks = await listIncompleteTasks(env, userId, pref?.tasks_list_ids ? JSON.parse(pref.tasks_list_ids) : void 0);
  const normalized = tasks.map((t) => ({
    id: t.id,
    title: t.title || "(untitled)",
    notes: t.notes || "",
    due: t.due?.dateTime || t.due?.date || null
  }));
  const est = await estimateTasks(env, userId, normalized);
  const slotsByDay = computeFreeSlots(horizonStart, horizonDays, tz, {
    horizon_days: horizonDays,
    working_start: pref?.working_start || "09:00",
    working_end: pref?.working_end || "17:00",
    min_block: pref?.min_block || 25,
    max_block: pref?.max_block || 90,
    buffer_minutes: buffer,
    max_daily_focus: pref?.max_daily_focus || 240,
    include_weekends: pref?.include_weekends ?? 0
  }, busyBuffered);
  const placements = planTasksIntoSlots(est, slotsByDay, {
    horizon_days: horizonDays,
    working_start: pref?.working_start || "09:00",
    working_end: pref?.working_end || "17:00",
    min_block: pref?.min_block || 25,
    max_block: pref?.max_block || 90,
    buffer_minutes: buffer,
    max_daily_focus: pref?.max_daily_focus || 240,
    include_weekends: pref?.include_weekends ?? 0
  }, tz);
  const runId = genId("run");
  let scheduled = 0;
  for (const p of placements) {
    const t = est.find((x) => x.id === p.taskId);
    const summary = `Focus: ${t.title}`;
    const event = {
      summary,
      description: `CalWeaver focus block
Task: ${t.title}
Chunk ${p.chunkIndex}/${p.chunkCount}`,
      start: { dateTime: p.start.toISOString() },
      end: { dateTime: p.end.toISOString() },
      extendedProperties: { private: { calweaver: "1", taskId: t.id, runId } }
    };
    const created = await insertEvent(env, userId, calId, event);
    await env.DB.prepare(`
      INSERT INTO scheduled_blocks (id, user_id, task_id, start, end, calendar_event_id, run_id, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `).bind(genId("blk"), userId, t.id, p.start.toISOString(), p.end.toISOString(), created.id, runId, nowIso()).run();
    scheduled++;
  }
  await env.DB.prepare(`
    INSERT INTO runs (run_id, user_id, started_at, horizon_start, horizon_end, stats_json)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(runId, userId, nowIso(), horizonStart.toISOString(), horizonEnd.toISOString(), JSON.stringify({ scheduled })).run();
  return new Response(JSON.stringify({ runId, stats: { scheduled } }), { headers: { "Content-Type": "application/json" } });
}, "onRequestPost");

// cron/daily.ts
var onRequestGet5 = /* @__PURE__ */ __name(async ({ env }) => {
  const users = await env.DB.prepare("SELECT id FROM users").all();
  const total = (users.results || []).length;
  return new Response(JSON.stringify({ total, note: "Use the UI Reshuffle button for now; wire cron later if desired." }), {
    headers: { "Content-Type": "application/json" }
  });
}, "onRequestGet");

// ../.wrangler/tmp/pages-NEBjwN/functionsRoutes-0.45917221493972193.mjs
var routes = [
  {
    routePath: "/oauth/google/callback",
    mountPath: "/oauth/google",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/oauth/google/start",
    mountPath: "/oauth/google",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/byok",
    mountPath: "/api",
    method: "DELETE",
    middlewares: [],
    modules: [onRequestDelete]
  },
  {
    routePath: "/api/byok",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/me",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/preferences",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/api/preferences",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/run",
    mountPath: "/api",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/cron/daily",
    mountPath: "/cron",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  }
];

// ../../../../../opt/homebrew/lib/node_modules/wrangler/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-EDMqXX/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-EDMqXX/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.14416446490543666.mjs.map
