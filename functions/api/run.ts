import { Env, getSessionUserId } from "../../lib/session";
import { ensureFocusCalendar, freeBusy, insertEvent, listEvents, listIncompleteTasks, listSelectedCalendars, deleteEvent } from "../../lib/google";
import { estimateTasks } from "../../lib/openai";
import { computeFreeSlots, planTasksIntoSlots } from "../../lib/scheduler";
import { genId, nowIso } from "../../lib/util";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const userId = await getSessionUserId(request, env);
  if (!userId) return new Response('Unauthorized', { status: 401 });

  const pref = await env.DB.prepare('SELECT * FROM preferences WHERE user_id=?1').bind(userId).first();
  const horizonDays = pref?.horizon_days ?? 7;
  const tz = (await env.DB.prepare('SELECT tz FROM users WHERE id=?1').bind(userId).first())?.tz || 'UTC';

  // Horizon window: today 00:00 to horizon end
  const now = new Date();
  const horizonStart = new Date(now); horizonStart.setHours(0,0,0,0);
  const horizonEnd = new Date(horizonStart.getTime() + horizonDays*86400000);

  // Ensure focus calendar
  const calId = await ensureFocusCalendar(env, userId);

  // Delete previous CalWeaver events in horizon (in that calendar)
  const events = await listEvents(env, userId, calId, horizonStart.toISOString(), horizonEnd.toISOString());
  for (const e of events) {
    await deleteEvent(env, userId, calId, e.id);
  }

  // Build busy intervals from all selected calendars (excluding our focus calendar)
  const calendars = (await listSelectedCalendars(env, userId))
    .map((c:any)=>c.id)
    .filter((id:string)=>id !== calId);
  const busy = await freeBusy(env, userId, horizonStart.toISOString(), horizonEnd.toISOString(), calendars);

  // Apply buffers
  const buffer = pref?.buffer_minutes ?? 10;
  const busyBuffered = busy.map(b => ({
    start: new Date(b.start.getTime() - buffer*60000),
    end: new Date(b.end.getTime() + buffer*60000)
  }));

  // Pull tasks
  const tasks = await listIncompleteTasks(env, userId, pref?.tasks_list_ids ? JSON.parse(pref.tasks_list_ids) : undefined);
  const normalized = tasks.map((t:any) => ({
    id: t.id,
    title: t.title || '(untitled)',
    notes: t.notes || '',
    due: t.due?.dateTime || t.due?.date || null
  }));

  // Estimate durations & priorities
  const est = await estimateTasks(env, userId, normalized);

  // Compute free slots
  const slotsByDay = computeFreeSlots(horizonStart, horizonDays, tz, {
    horizon_days: horizonDays,
    working_start: pref?.working_start || '09:00',
    working_end: pref?.working_end || '17:00',
    min_block: pref?.min_block || 25,
    max_block: pref?.max_block || 90,
    buffer_minutes: buffer,
    max_daily_focus: pref?.max_daily_focus || 240,
    include_weekends: pref?.include_weekends ?? 0
  }, busyBuffered);

  // Plan placements
  const placements = planTasksIntoSlots(est, slotsByDay, {
    horizon_days: horizonDays,
    working_start: pref?.working_start || '09:00',
    working_end: pref?.working_end || '17:00',
    min_block: pref?.min_block || 25,
    max_block: pref?.max_block || 90,
    buffer_minutes: buffer,
    max_daily_focus: pref?.max_daily_focus || 240,
    include_weekends: pref?.include_weekends ?? 0
  }, tz);

  // Create events
  const runId = genId('run');
  let scheduled = 0;
  for (const p of placements) {
    const t = est.find(x => x.id === p.taskId)!;
    const summary = `Focus: ${t.title}`;
    const event = {
      summary,
      description: `CalWeaver focus block\nTask: ${t.title}\nChunk ${p.chunkIndex}/${p.chunkCount}`,
      start: { dateTime: p.start.toISOString() },
      end: { dateTime: p.end.toISOString() },
      extendedProperties: { private: { calweaver: "1", taskId: t.id, runId } }
    };
    const created = await insertEvent(env, userId, calId, event);
    await env.DB.prepare(`
      INSERT INTO scheduled_blocks (id, user_id, task_id, start, end, calendar_event_id, run_id, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `).bind(genId('blk'), userId, t.id, p.start.toISOString(), p.end.toISOString(), created.id, runId, nowIso()).run();
    scheduled++;
  }

  // Record run
  await env.DB.prepare(`
    INSERT INTO runs (run_id, user_id, started_at, horizon_start, horizon_end, stats_json)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(runId, userId, nowIso(), horizonStart.toISOString(), horizonEnd.toISOString(), JSON.stringify({ scheduled })).run();

  return new Response(JSON.stringify({ runId, stats: { scheduled } }), { headers: { 'Content-Type':'application/json' } });
};
