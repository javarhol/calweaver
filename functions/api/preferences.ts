import { Env, getSessionUserId } from "../../lib/session";
import { ensurePreferences } from "../../lib/google";
import { nowIso } from "../../lib/util";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response('Unauthorized', { status: 401 });
  const pref = await ensurePreferences(env, userId);
  return new Response(JSON.stringify(pref), { headers: { 'Content-Type':'application/json' } });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response('Unauthorized', { status: 401 });
  const body = await request.json<any>();
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
  return new Response(JSON.stringify(pref), { headers: { 'Content-Type':'application/json' } });
};
