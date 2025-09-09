import { Env, getSessionUserId } from "../../lib/session";
import { getUser } from "../../lib/google";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response(JSON.stringify({ connected: false }), { status: 200, headers: { 'Content-Type':'application/json' } });
  const user = await getUser(env, userId);
  const byok = await env.DB.prepare('SELECT 1 FROM openai_keys WHERE user_id=?1').bind(userId).first();
  return new Response(JSON.stringify({
    connected: true,
    email: user?.email,
    tz: user?.tz,
    byok: !!byok
  }), { headers: { 'Content-Type':'application/json' } });
};
