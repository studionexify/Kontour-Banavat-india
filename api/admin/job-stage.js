/* POST /api/admin/job-stage — set a job's stage (production/completed)
 * directly on the shared books, bypassing the app.
 *
 * This is not a user-facing route: it is gated by its own bearer secret
 * (ADMIN_TOKEN) rather than a Supabase session, so that operating it
 * never requires the Supabase service role key to leave this function.
 * The service role key stays a Vercel-only env var; this route is the
 * one narrow door onto it, and ADMIN_TOKEN is the only thing that has
 * to be shared to use that door.
 *
 * A job is a `records` row (kind='job', id=<code>) whose `data` JSONB is
 * the same object store.js keeps on the device — so this reads that
 * row, flips just the one field, and writes it back with a fresh
 * updated_at. The next sync on any device pulls the change normally;
 * nothing here talks to a device directly.
 */

function bad(res, status, message) {
  res.status(status).json({ error: message });
  return null;
}

function authorized(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const h = req.headers.authorization || '';
  const given = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  return Boolean(given) && given === token;
}

const STAGES = ['production', 'completed'];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'POST only');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return bad(res, 500, 'Server is missing its Supabase configuration');
  }
  if (!process.env.ADMIN_TOKEN) return bad(res, 500, 'Server is missing ADMIN_TOKEN');
  if (!authorized(req)) return bad(res, 401, 'Bad or missing admin token');

  const { orgId, code, stage } = req.body || {};
  if (!orgId) return bad(res, 400, 'No organisation named');
  if (!code) return bad(res, 400, 'No job code given');
  if (!STAGES.includes(stage)) return bad(res, 400, `stage must be one of: ${STAGES.join(', ')}`);

  const jobCode = String(code).trim().toUpperCase();
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  };

  const findUrl = `${process.env.SUPABASE_URL}/rest/v1/records`
    + `?select=id,data&org_id=eq.${encodeURIComponent(orgId)}`
    + `&kind=eq.job&id=eq.${encodeURIComponent(jobCode)}&deleted_at=is.null&limit=1`;

  const findRes = await fetch(findUrl, { headers });
  if (!findRes.ok) return bad(res, 502, 'Could not read that job');
  const rows = await findRes.json();
  if (!Array.isArray(rows) || !rows.length) {
    return bad(res, 404, `No job ${jobCode} on these books`);
  }

  const data = { ...rows[0].data, stage };

  const patchUrl = `${process.env.SUPABASE_URL}/rest/v1/records`
    + `?org_id=eq.${encodeURIComponent(orgId)}&kind=eq.job&id=eq.${encodeURIComponent(jobCode)}`;

  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { ...headers, prefer: 'return=minimal' },
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
  if (!patchRes.ok) {
    const detail = await patchRes.text().catch(() => '');
    return bad(res, 502, `Could not save that job${detail ? `: ${detail}` : ''}`);
  }

  return res.status(200).json({ code: jobCode, stage });
}
