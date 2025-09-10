import { Env, getSessionUserId } from "../../lib/session"; import { ensureFocusCalendar, ensurePreferences, listEvents, listSelectedCalendars } from "../../lib/google";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => { const userId = await getSessionUserId(request, env); if (!userId) return new Response('Unauthorized', { status: 401 });

const pref = await ensurePreferences(env, userId); const horizonDays = pref?.horizon_days ?? 7;

const now = new Date(); const timeMin = new Date(now); timeMin.setHours(0,0,0,0); const timeMax = new Date(timeMin.getTime() + horizonDays * 86400000);

const focusCalId = await ensureFocusCalendar(env, userId); const calendars = (await listSelectedCalendars(env, userId)).filter((c: any) => c.id !== focusCalId);

const events: any[] = []; for (const cal of calendars) { const items = await listEvents(env, userId, cal.id, timeMin.toISOString(), timeMax.toISOString()); for (const e of items) { const start = e.start?.dateTime || (e.start?.date ? e.start.date + 'T00:00:00Z' : null); const end = e.end?.dateTime || (e.end?.date ? e.end.date + 'T00:00:00Z' : null); events.push({ id: e.id, calendarId: cal.id, calendar: cal.summary, summary: e.summary || '(no title)', start, end, allDay: Boolean(e.start?.date) }); } }

events.sort((a, b) => (new Date(a.start).getTime()) - (new Date(b.start).getTime()));

return new Response(JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), events }), { headers: { 'Content-Type': 'application/json' } }); };