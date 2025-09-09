import { decryptAesGcm } from "./crypto";

export async function getOpenAIKey(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT key_enc, key_iv FROM openai_keys WHERE user_id=?1').bind(userId).first();
  if (!row) return null;
  return await decryptAesGcm(row.key_enc, row.key_iv, env.MASTER_ENCRYPTION_KEY);
}

export async function estimateTasks(env: Env, userId: string, tasks: any[]): Promise<Array<{
  id: string, title: string, notes?: string, due?: string,
  durationMinutes: number, chunkMinutes: number, priority: number
}>> {
  const key = await getOpenAIKey(env, userId);
  if (!key) throw new Error('No OpenAI key stored.');
  if (!tasks.length) return [];
  const truncated = tasks.slice(0, 50); // safety
  const prompt = `
You estimate task attributes. For each task, output JSON object with:
{id, durationMinutes, chunkMinutes, priority}
Rules:
- durationMinutes ∈ [15, 480]
- chunkMinutes ∈ [15, 120]
- priority ∈ [1 (low) .. 5 (high)]
- If due is near (within 48h), bump priority.
Here are tasks:
${truncated.map(t => `- id:${t.id} title:${t.title} notes:${(t.notes||'').slice(0,200)} due:${t.due || 'none'}`).join('\n')}
Return ONLY an array of JSON objects.
  `.trim();

  const res = await fetch((env.OPENAI_API_BASE || 'https://api.openai.com/v1') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: env.DEFAULT_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You return concise, valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 800
    })
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
  const data = await res.json<any>();
  const text = data.choices?.[0]?.message?.content?.trim() || '[]';
  let jsonText = text.replace(/```json|```/g, '');
  let arr: any[] = [];
  try { arr = JSON.parse(jsonText); } catch {
    // fallback heuristic if parsing fails
    return truncated.map((t:any) => ({
      id: t.id, title: t.title, notes: t.notes, due: t.due,
      durationMinutes: Math.min(240, Math.max(30, (t.title || '').length * 2)),
      chunkMinutes: 50, priority: 3
    }));
  }
  const map = new Map(truncated.map((t:any)=>[t.id,t]));
  const clamp = (v:number,min:number,max:number)=>Math.max(min,Math.min(max,Math.round(v)));
  return arr.map((o:any) => {
    const base = map.get(o.id);
    return {
      id: o.id,
      title: base?.title || '',
      notes: base?.notes,
      due: base?.due,
      durationMinutes: clamp(o.durationMinutes ?? 60, 15, 480),
      chunkMinutes: clamp(o.chunkMinutes ?? 50, 15, 120),
      priority: clamp(o.priority ?? 3, 1, 5)
    };
  });
}

export type Env = import('./session').Env;
