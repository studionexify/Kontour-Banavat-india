/* POST /api/admin/users — the owner making, re-passwording and removing
 * the accounts of everyone else.
 *
 * These books have one account with an email behind it: the owner's.
 * Everyone else signs in with a username and a password that the owner
 * hands them in person. Creating such an account means writing to
 * GoTrue's admin API, which needs the service role key, and that key
 * exists only here — so the browser asks this route and this route,
 * having checked that the caller really is the owner of the org they
 * named, does the work.
 *
 * Three actions, all POSTed to the same path so there is one door to
 * guard rather than three:
 *   create   — username + password + role → an account on these books
 *   password — set someone's password, in place of a reset email
 *   remove   — take them off the books, and delete the account itself
 *              when it is a username one that exists only for these books
 */

import { cors, bad, currentUser } from '../_lib/auth.js';

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'furniture@banavat-india.com')
  .trim().toLowerCase();
const STAFF_DOMAIN = (process.env.STAFF_EMAIL_DOMAIN || 'staff.kontour.app')
  .trim().toLowerCase();

const ROLES = ['admin', 'staff', 'viewer'];

function svc() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  };
}

function cleanUsername(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

/** Reads a message out of a GoTrue or PostgREST failure. */
async function why(res, fallback) {
  let out = {};
  try { out = await res.json(); } catch {}
  return out.msg || out.message || out.error_description || out.error || fallback;
}

/**
 * The gate. The caller must be signed in, must be the owner address,
 * and must actually hold the owner role on the org they named — the
 * address alone is not enough, since an org they do not own is none of
 * their business either.
 */
async function requireOwner(req, res, orgId) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return bad(res, 500, 'Server is missing its Supabase configuration');
  }
  if (!orgId) return bad(res, 400, 'No organisation named');

  const user = await currentUser(req);
  if (!user) return bad(res, 401, 'Sign in to continue');

  if (String(user.email || '').toLowerCase() !== OWNER_EMAIL) {
    return bad(res, 403, 'Only the owner can manage accounts');
  }

  const url = `${process.env.SUPABASE_URL}/rest/v1/memberships`
    + `?select=role&org_id=eq.${encodeURIComponent(orgId)}`
    + `&user_id=eq.${encodeURIComponent(user.id)}&limit=1`;
  const look = await fetch(url, { headers: svc() });
  if (!look.ok) return bad(res, 502, 'Could not check your access');

  const rows = await look.json();
  if (!Array.isArray(rows) || rows[0]?.role !== 'owner') {
    return bad(res, 403, 'Only the owner can manage accounts');
  }
  return user;
}

/** The one account we are allowed to touch: a member of this org. */
async function memberOf(orgId, userId) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/memberships`
    + `?select=role,user_id,profiles(email)&org_id=eq.${encodeURIComponent(orgId)}`
    + `&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  const res = await fetch(url, { headers: svc() });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export default async function handler(req, res) {
  if (!cors(req, res)) return bad(res, 403, 'Origin not allowed');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'POST only');

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { orgId, action, userId } = body;

  const owner = await requireOwner(req, res, orgId);
  if (!owner) return;

  if (action === 'create') return create(req, res, body, orgId);
  if (action === 'password') return setPassword(req, res, body, orgId);
  if (action === 'remove') return remove(req, res, userId, orgId, owner);
  return bad(res, 400, 'Unknown action');
}

/* ── create ────────────────────────────────────────────────── */

async function create(req, res, body, orgId) {
  const username = cleanUsername(body.username);
  const password = String(body.password || '');
  const role = ROLES.includes(body.role) ? body.role : 'staff';
  const fullName = String(body.fullName || '').trim() || username;

  if (username.length < 3) {
    return bad(res, 400, 'A username is at least 3 letters or digits (a–z, 0–9, . _ -).');
  }
  if (password.length < 8) return bad(res, 400, 'Passwords are at least 8 characters.');

  const email = `${username}@${STAFF_DOMAIN}`;

  // email_confirm so there is nothing to confirm: the address is a
  // stand-in for a username and no mail will ever reach it.
  const made = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svc(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, username },
    }),
  });

  if (!made.ok) {
    const msg = await why(made, 'Could not create that account');
    if (/already|registered|exists|duplicate/i.test(msg)) {
      return bad(res, 409, `The username “${username}” is taken.`);
    }
    return bad(res, 502, msg);
  }

  const user = await made.json();

  // The profile row comes from the on_auth_user_created trigger; the
  // membership is ours to make, since there is no invite to match.
  const joined = await fetch(`${process.env.SUPABASE_URL}/rest/v1/memberships`, {
    method: 'POST',
    headers: { ...svc(), prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ org_id: orgId, user_id: user.id, role }),
  });

  if (!joined.ok) {
    // Leaving a signed-up account with no books to open would be worse
    // than failing outright, so undo it.
    await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE', headers: svc(),
    }).catch(() => {});
    return bad(res, 502, await why(joined, 'Could not add them to these books'));
  }

  return res.status(200).json({ ok: true, userId: user.id, username, role });
}

/* ── password ──────────────────────────────────────────────── */

async function setPassword(req, res, body, orgId) {
  const password = String(body.password || '');
  const userId = String(body.userId || '');
  if (!userId) return bad(res, 400, 'No account named');
  if (password.length < 8) return bad(res, 400, 'Passwords are at least 8 characters.');

  const m = await memberOf(orgId, userId);
  if (!m) return bad(res, 404, 'That account is not on these books');
  if (m.role === 'owner') return bad(res, 403, 'Change the owner password from the sign-in screen.');

  const out = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: svc(),
    body: JSON.stringify({ password }),
  });
  if (!out.ok) return bad(res, 502, await why(out, 'Could not set that password'));

  return res.status(200).json({ ok: true });
}

/* ── remove ────────────────────────────────────────────────── */

async function remove(req, res, userId, orgId, owner) {
  if (!userId) return bad(res, 400, 'No account named');
  if (userId === owner.id) return bad(res, 403, 'The owner cannot be removed.');

  const m = await memberOf(orgId, userId);
  if (!m) return bad(res, 404, 'That account is not on these books');
  if (m.role === 'owner') return bad(res, 403, 'The owner cannot be removed.');

  const gone = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/memberships`
      + `?org_id=eq.${encodeURIComponent(orgId)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'DELETE', headers: svc() },
  );
  if (!gone.ok) return bad(res, 502, await why(gone, 'Could not remove them'));

  // A username account exists only for these books, so it goes with the
  // membership. A real email address might belong elsewhere; that one
  // only loses its access.
  const email = String(m.profiles?.email || '').toLowerCase();
  if (email.endsWith(`@${STAFF_DOMAIN}`)) {
    await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE', headers: svc(),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true });
}
