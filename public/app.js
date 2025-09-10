async function fetchJSON(url, opts = {}) { const res = await fetch(url, { credentials: 'include', ...opts }); if (!res.ok) throw new Error(await res.text()); return res.json(); } function qs(id) { return document.getElementById(id); } function fmtDate(dt) { try { const d = new Date(dt); return d.toLocaleString(); } catch { return dt || ''; } }

async function loadMe() { try { const me = await fetchJSON('/api/me'); const div = qs('me'); if (me.connected) { div.textContent = Connected as ${me.email} — tz: ${me.tz || 'unknown'}; qs('connect-google').style.display = 'none'; } else { div.textContent = 'Not connected to Google yet.'; } if (me.byok) qs('byok-status').textContent = 'OpenAI key is stored (encrypted).'; } catch (e) { console.error(e); } }

async function saveKey() { const k = qs('openai-key').value.trim(); if (!k) return; await fetchJSON('/api/byok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }) }); qs('byok-status').textContent = 'Saved.'; qs('openai-key').value = ''; }

async function clearKey() { await fetchJSON('/api/byok', { method: 'DELETE' }); qs('byok-status').textContent = 'Cleared.'; }

async function loadPrefs() { try { const p = await fetchJSON('/api/preferences'); qs('horizon').value = p.horizon_days ?? 7; qs('start').value = p.working_start ?? '09:00'; qs('end').value = p.working_end ?? '17:00'; qs('minBlock').value = p.min_block ?? 25; qs('maxBlock').value = p.max_block ?? 90; qs('buffer').value = p.buffer_minutes ?? 10; qs('maxDaily').value = p.max_daily_focus ?? 240; } catch {} }

async function reshuffleNow() { qs('run-status').textContent = 'Reshuffling...'; try { const res = await fetchJSON('/api/run', { method: 'POST' }); qs('run-status').textContent = Done. Scheduled ${res.stats?.scheduled ?? 0} blocks.; } catch (e) { qs('run-status').textContent = Error: ${e.message}; } }

async function loadTasks() { const ul = qs('tasks-list'); ul.innerHTML = '<li class="muted">Loading tasks…</li>'; try { const data = await fetchJSON('/api/tasks'); if (!data.tasks.length) { ul.innerHTML = '<li class="muted">No incomplete tasks found.</li>'; return; } ul.innerHTML = ''; for (const t of data.tasks.slice(0, 100)) { const li = document.createElement('li'); li.innerHTML = <div class="title">${escapeHtml(t.title)}</div> <div class="meta">${escapeHtml(t.listTitle)}${t.due ? ' • due ' + escapeHtml(fmtDate(t.due)) : ''}</div> ${t.notes ?<div class="notes">${escapeHtml(t.notes.slice(0, 140))}</div>: ''} ; ul.appendChild(li); } } catch (e) { ul.innerHTML = <li class="error">Error loading tasks: ${escapeHtml(e.message)}</li>; } }

async function loadEvents() { const ul = qs('events-list'); ul.innerHTML = '<li class="muted">Loading events…</li>'; try { const data = await fetchJSON('/api/calendar'); if (!data.events.length) { ul.innerHTML = '<li class="muted">No upcoming events in the horizon.</li>'; return; } ul.innerHTML = ''; for (const e of data.events.slice(0, 200)) { const li = document.createElement('li'); li.innerHTML = <div class="title">${escapeHtml(e.summary)}</div> <div class="meta">${escapeHtml(e.calendar)} • ${e.allDay ? 'All day' :${escapeHtml(fmtDate(e.start))} → ${escapeHtml(fmtDate(e.end))}}</div> ; ul.appendChild(li); } } catch (e) { ul.innerHTML = <li class="error">Error loading events: ${escapeHtml(e.message)}</li>; } }

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'''}[c])); }

async function refreshPreview() { await Promise.all([loadTasks(), loadEvents()]); }

qs('connect-google').addEventListener('click', () => { window.location.href = '/oauth/google/start'; }); qs('save-key').addEventListener('click', saveKey); qs('clear-key').addEventListener('click', clearKey); qs('save-prefs').addEventListener('click', savePrefs); qs('reshuffle-now').addEventListener('click', reshuffleNow); qs('refresh-preview').addEventListener('click', refreshPreview);

loadMe(); loadPrefs(); refreshPreview();

