import { Env } from "../../lib/session";

// Cron schedule is set in Cloudflare Pages project settings.
// This placeholder counts users; for MVP we use the UI "Reshuffle now" button.

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const users = await env.DB.prepare('SELECT id FROM users').all();
  const total = (users.results || []).length;
  return new Response(JSON.stringify({ total, note: "Use the UI Reshuffle button for now; wire cron later if desired." }), {
    headers: { 'Content-Type': 'application/json' }
  });
};
