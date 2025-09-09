import { Env, getSessionUserId } from "../../lib/session";
import { encryptAesGcm } from "../../lib/crypto";
import { nowIso } from "../../lib/util";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response('Unauthorized', { status: 401 });
  const { key } = await request.json<any>();
  if (!key || !/^sk-/.test(key)) return new Response('Invalid key', { status: 400 });
  const enc = await encryptAesGcm(key, env.MASTER_ENCRYPTION_KEY);
  await env.DB.prepare(`
    INSERT INTO openai_keys (user_id, key_enc, key_iv, created_at)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(user_id) DO UPDATE SET key_enc=excluded.key_enc, key_iv=excluded.key_iv
  `).bind(userId, enc.ct, enc.iv, nowIso()).run();
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type':'application/json' } });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response('Unauthorized', { status: 401 });
  await env.DB.prepare('DELETE FROM openai_keys WHERE user_id=?1').bind(userId).run();
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type':'application/json' } });
};
