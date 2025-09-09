async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function qs(id) { return document.getElementById(id); }

async function loadMe() {
  try {
    const me = await fetchJSON('/api/me');
    const div = qs('me');
    if (me.connected) {
      div.textContent = `Connected as ${me.email} — tz: ${me.tz || 'unknown'}`;
      qs('connect-google').style.display = 'none';
    } else {
      div.textContent = 'Not connected to Google yet.';
    }
    if (me.byok) qs('byok-status').textContent = 'OpenAI key is stored (encrypted).';
  } catch (e) {
    console.error(e);
  }
}

async function saveKey() {
  const k = qs('openai-key').value.trim();
  if (!k) return;
  await fetchJSON('/api/byok', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: k })
  });
  qs('byok-status').textContent = 'Saved.';
  qs('openai-key').value = '';
}

async function clearKey() {
  await fetchJSON('/api/byok', { method: 'DELETE' });
  qs('byok-status').textContent = 'Cleared.';
}

async function loadPrefs() {
  try {
    const p = await fetchJSON('/api/preferences');
    qs('horizon').value = p.horizon_days ?? 7;
    qs('start').value = p.working_start ?? '09:00';
    qs('end').value = p.working_end ?? '17:00';
    qs('minBlock').value = p.min_block ?? 25;
    qs('maxBlock').value = p.max_block ?? 90;
    qs('buffer').value = p.buffer_minutes ?? 10;
    qs('maxDaily').value = p.max_daily_focus ?? 240;
  } catch {}
}

async function reshuffleNow() {
  qs('run-status').textContent = 'Reshuffling...';
  try {
    const res = await fetchJSON('/api/run', { method: 'POST' });
    qs('run-status').textContent = `Done. Scheduled ${res.stats?.scheduled ?? 0} blocks.`;
  } catch (e) {
    qs('run-status').textContent = `Error: ${e.message}`;
  }
}

async function savePrefs() {
  const body = {
    horizon_days: Number(qs('horizon').value),
    working_start: qs('start').value,
    working_end: qs('end').value,
    min_block: Number(qs('minBlock').value),
    max_block: Number(qs('maxBlock').value),
    buffer_minutes: Number(qs('buffer').value),
    max_daily_focus: Number(qs('maxDaily').value)
  };
  await fetchJSON('/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  qs('prefs-status').textContent = 'Saved.';
}

qs('connect-google').addEventListener('click', () => {
  window.location.href = '/oauth/google/start';
});
qs('save-key').addEventListener('click', saveKey);
qs('clear-key').addEventListener('click', clearKey);
qs('save-prefs').addEventListener('click', savePrefs);
qs('reshuffle-now').addEventListener('click', reshuffleNow);

loadMe();
loadPrefs();
