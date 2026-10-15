// Bufete Lozada Colón — copies Vapi calls into the Supabase archive.
// Run once after deploy, then daily via cron-job.org:
//   https://YOUR-SITE.netlify.app/.netlify/functions/sync
const ASSISTANT_ID = '56952efa-0f8d-4618-8bd7-6d0f86f63342';
const API_KEY = 'e19f3aaf-e171-4e14-80c4-57c4139328e7';
const SUPABASE_URL = 'https://haxozjahcnktbliephdx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhheG96amFoY25rdGJsaWVwaGR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjgwMzIsImV4cCI6MjA5NzgwNDAzMn0.f5hw4q11wtPeTU6A21xaX9qJdCkFdMWZ1qCKOrwaeZE';
const INTAKE_ID = '04f717a6-4163-4060-82ed-642c54e1701e'; // "Lozada Intake" structured output

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function getIntake(c) {
  const so = c.artifact?.structuredOutputs;
  if (!so || typeof so !== 'object') return {};
  if (so[INTAKE_ID]?.result) return so[INTAKE_ID].result;
  const byName = Object.values(so).find(o => o && o.name === 'Lozada Intake' && o.result);
  return byName ? byName.result : {};
}
function duration(c) {
  if (c.startedAt && c.endedAt) {
    const d = (new Date(c.endedAt) - new Date(c.startedAt)) / 1000;
    return d > 0 ? Math.round(d) : 0;
  }
  return 0;
}

exports.handler = async function () {
  try {
    const r = await fetch(`https://api.vapi.ai/call?assistantId=${ASSISTANT_ID}&limit=1000`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    if (!r.ok) return json(r.status, { error: 'Vapi ' + r.status });
    const data = await r.json();
    const calls = Array.isArray(data) ? data : (data.results || data.calls || []);

    const rows = calls
      .filter(c => c.startedAt && c.status === 'ended')
      .map(c => {
        const intake = getIntake(c);
        return {
          id: c.id,
          assistant_id: ASSISTANT_ID,
          caller_number: c.customer?.number || null,
          caller_name: intake.nombre_cliente || null,
          duration: duration(c),
          started_at: c.startedAt,
          ended_at: c.endedAt || null,
          recording_url: c.artifact?.recordingUrl || c.recordingUrl || null,
          summary: c.analysis?.summary || null,
          call_reason: intake.motivo || null,
          transcript: c.artifact?.transcript || null,
          end_reason: c.endedReason || null
        };
      });

    if (!rows.length) return json(200, { synced: 0 });

    const up = await fetch(`${SUPABASE_URL}/rest/v1/calls?on_conflict=id`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows)
    });
    if (!up.ok) return json(up.status, { error: 'Supabase ' + up.status + ': ' + (await up.text()) });
    return json(200, { synced: rows.length });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
