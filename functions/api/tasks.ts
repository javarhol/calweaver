import { Env, getSessionUserId } from "../../lib/session"; import { listTaskLists, listIncompleteTasks } from "../../lib/google";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => { const userId = await getSessionUserId(request, env); if (!userId) return new Response('Unauthorized', { status: 401 });

// Get lists, figure out which lists to include (preferences or all) const lists = await listTaskLists(env, userId); const pref = await env.DB.prepare('SELECT tasks_list_ids FROM preferences WHERE user_id=?1').bind(userId).first(); const includeIds: string[] = pref?.tasks_list_ids ? JSON.parse(pref.tasks_list_ids) : lists.map((l: any) => l.id);

const tasks = await listIncompleteTasks(env, userId, includeIds); const listMap = new Map(lists.map((l: any) => [l.id, l.title]));

const items = tasks.map((t: any) => ({ id: t.id, title: t.title || '(untitled)', notes: t.notes || '', due: t.due || null, listId: t.listId, listTitle: listMap.get(t.listId) || 'Tasks' }));

return new Response(JSON.stringify({ lists, tasks: items }), { headers: { 'Content-Type': 'application/json' } }); };

