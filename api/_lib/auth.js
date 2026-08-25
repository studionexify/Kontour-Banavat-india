/* auth.js — who is calling, and may they touch this org's books.
 *
 * Every route that reaches Drive or spends API credit goes through
 * requireMember() first. Without it these endpoints are an open relay:
 * the Drive folder and the Claude key both sit behind them.
 *
 * Two checks, deliberately kept apart:
 *   1. Is the bearer token a real, unexpired Supabase session — asked
 *      of Supabase itself, so a revoked session stops working at once
 *      rather than when its JWT would have expired.
 *   2. Is that user a member of the org they named — asked with the
 *      service role, because the caller's own RLS view is exactly what
 *      an attacker would be trying to forge.
 */

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

export function cors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-max-age', '86400');

  // An empty allowlist means same-origin only, which is the common case
  // now that the app and these routes deploy together.
  const ok = !origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin);
  if (ok && origin) res.setHeader('access-control-allow-origin', origin);
  return ok;
}

export function bad(res, status, message) {
  res.status(status).json({ error: message });
  return null;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/** Resolves the token to a user, or null. */
export async function currentUser(req) {
  const token = bearer(req);
  if (!token) return null;

  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) return null;

  const user = await res.json();
  return user && user.id ? user : null;
}

/**
 * The gate every protected route opens with. Returns { user, role } on
 * success; on failure it has already sent the response and returns null,
 * so a caller only has to check for null.
 */
export async function requireMember(req, res, orgId, { write = false } = {}) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return bad(res, 500, 'Server is missing its Supabase configuration');
  }
  if (!orgId) return bad(res, 400, 'No organisation named');

  const user = await currentUser(req);
  if (!user) return bad(res, 401, 'Sign in to continue');

  const url = `${process.env.SUPABASE_URL}/rest/v1/memberships`
    + `?select=role&org_id=eq.${encodeURIComponent(orgId)}`
    + `&user_id=eq.${encodeURIComponent(user.id)}&limit=1`;

  const res2 = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res2.ok) return bad(res, 502, 'Could not check your access');

  const rows = await res2.json();
  if (!Array.isArray(rows) || !rows.length) {
    // Deliberately the same answer as a missing org: telling a stranger
    // that an org exists but is not theirs is itself information.
    return bad(res, 403, 'You do not have access to these books');
  }

  const role = rows[0].role;
  if (write && !['owner', 'admin', 'staff'].includes(role)) {
    return bad(res, 403, 'Your account has read-only access');
  }
  return { user, role };
}
