import { Env, sessionCookieHeader, setSession } from "../../../lib/session";
import { exchangeAuthCodeForTokens, getTimezone, getUserInfo, upsertUserIdentity } from "../../../lib/google";
import { nowIso } from "../../../lib/util";
import { encryptAesGcm } from "../../../lib/crypto";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookie = request.headers.get('Cookie') || '';
  const m = /oauth_state=([^;]+)/.exec(cookie);
  const cookieState = m ? decodeURIComponent(m[1]) : null;
  if (!code || !state || state !== cookieState) {
    return new Response('Invalid OAuth state', { status: 400 });
  }
  const redirectUri = new URL('/oauth/google/callback', url.origin).toString();
  const tokens = await exchangeAuthCodeForTokens(code, redirectUri, env);

  // Get user info
  const userinfo = await getUserInfo(tokens.access_token);
  await upsertUserIdentity(userinfo.sub, userinfo.email, userinfo.name, env);

  // Store tokens encrypted
  const now = nowIso();
  const at = await encryptAesGcm(tokens.access_token, env.MASTER_ENCRYPTION_KEY);
  const rt = tokens.refresh_token ? await encryptAesGcm(tokens.refresh_token, env.MASTER_ENCRYPTION_KEY) : null;
  const accessExpiry = Math.floor(Date.now()/1000) + (tokens.expires_in || 3600) - 60;
  await env.DB.prepare(`
    INSERT INTO users (id, email, name, google_access_token_enc, google_access_iv, google_access_expiry, google_refresh_token_enc, google_refresh_iv, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, google_access_token_enc=excluded.google_access_token_enc, google_access_iv=excluded.google_access_iv, google_access_expiry=excluded.google_access_expiry, google_refresh_token_enc=COALESCE(excluded.google_refresh_token_enc, users.google_refresh_token_enc), google_refresh_iv=COALESCE(excluded.google_refresh_iv, users.google_refresh_iv), updated_at=excluded.updated_at
  `).bind(userinfo.sub, userinfo.email, userinfo.name || null, at.ct, at.iv, accessExpiry, rt?.ct || null, rt?.iv || null, now).run();

  // Try to capture timezone
  try {
    const tz = await getTimezone(env, userinfo.sub);
    await env.DB.prepare('UPDATE users SET tz=?1, updated_at=?2 WHERE id=?3').bind(tz, now, userinfo.sub).run();
  } catch {}

  const sess = await setSession(userinfo.sub, env);
  return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': sessionCookieHeader(sess) } });
};
