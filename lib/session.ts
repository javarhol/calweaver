function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
async function importHmacKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64ToBytes(b64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function hmac(b64Key: string, data: string): Promise<string> {
  const key = await importHmacKey(b64Key);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const arr = new Uint8Array(sig);
  let s = ""; for (let i=0;i<arr.length;i++) s+=String.fromCharCode(arr[i]);
  return btoa(s);
}

export async function setSession(userId: string, env: Env): Promise<string> {
  const ts = Date.now().toString();
  const payload = `${userId}|${ts}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${payload}|${sig}`;
}
export async function getSessionUserId(req: Request, env: Env): Promise<string | null> {
  const cookie = req.headers.get('Cookie') || '';
  const m = /cw_session=([^;]+)/.exec(cookie);
  if (!m) return null;
  const val = decodeURIComponent(m[1]);
  const parts = val.split('|');
  if (parts.length !== 3) return null;
  const [userId, ts, sig] = parts;
  const expected = await hmac(env.SESSION_SECRET, `${userId}|${ts}`);
  if (sig !== expected) return null;
  return userId;
}
export function sessionCookieHeader(value: string): string {
  const maxAge = 60 * 60 * 24 * 30;
  return `cw_session=${encodeURIComponent(value)}; HttpOnly; Secure; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export type Env = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MASTER_ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  OPENAI_API_BASE: string;
  DEFAULT_MODEL: string;
}
