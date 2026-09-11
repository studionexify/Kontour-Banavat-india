/* auth.js — accounts, sessions and which books you are looking at.
 *
 * Raw fetch against GoTrue rather than the Supabase SDK, for the same
 * reason sync.js calls the Messages API directly: this is a no-build
 * app, and a CDN import is a network dependency on the one path that
 * has to work with no signal. The REST surface used here is four
 * endpoints wide.
 *
 * The session lives in localStorage so a closed tab does not mean
 * signing in again. That is the same trade every web app makes; the PIN
 * lock is what stands between a borrowed phone and the books.
 */

import {
  SUPABASE_URL, SUPABASE_ANON_KEY, cloudConfigured,
  api, loginEmail, isOwnerEmail, OWNER_EMAIL,
} from './config.js';
import './legacy.js';   // moves pre-rename storage across; must load first

const SESSION_KEY = 'kontour.session';
const ORG_KEY = 'kontour.org';

let session = null;
let refreshing = null;          // in-flight refresh, shared by every caller
const listeners = new Set();

/* ── Session storage ───────────────────────────────────────── */

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
  listeners.forEach((fn) => fn(s));
}

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadSession() {
  if (session === null) session = readSession();
  return session;
}

export function signedIn() {
  return Boolean(loadSession() && loadSession().refresh_token);
}

export function currentUser() {
  const s = loadSession();
  return s ? s.user : null;
}

/* ── GoTrue ────────────────────────────────────────────────── */

async function gotrue(path, { method = 'POST', body, token } = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let out = {};
  try { out = text ? JSON.parse(text) : {}; } catch {}

  if (!res.ok) {
    // GoTrue puts the readable part in different fields depending on
    // which way the request was wrong.
    const msg = out.error_description || out.msg || out.message || out.error || `Sign-in failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return out;
}

/** Turns a GoTrue token response into the shape kept in storage. */
function store(out) {
  if (!out.access_token) return null;
  writeSession({
    access_token: out.access_token,
    refresh_token: out.refresh_token,
    // expires_in is seconds from now; an absolute time survives a reload.
    expires_at: Date.now() + (out.expires_in || 3600) * 1000,
    user: out.user || (session && session.user) || null,
  });
  return session;
}

export async function signIn(identifier, password) {
  const email = loginEmail(identifier);
  if (!email) throw new Error('Enter your username.');
  const out = await gotrue('/token?grant_type=password', {
    body: { email, password },
  });
  return store(out);
}

/**
 * The owner's own account, and only theirs.
 *
 * Staff never come through here — the owner makes their accounts from
 * Settings → People, server-side. This exists for the single moment at
 * the beginning of the books' life when the owner's account does not
 * exist yet, and it refuses any other address so that nobody can sign
 * themselves up into the business.
 */
export async function signUpOwner(email, password, fullName = '') {
  if (!isOwnerEmail(email)) {
    throw new Error(`Only ${OWNER_EMAIL} can create the owner account.`);
  }
  const out = await gotrue('/signup', {
    body: {
      email: String(email).trim().toLowerCase(),
      password,
      data: { full_name: fullName },
      // Without this GoTrue falls back to the Site URL configured in the
      // Supabase dashboard, which can drift from the live domain (see
      // SETUP.md's history of moving hosts) and send confirmation links
      // to a dead page.
      redirect_to: window.location.origin,
    },
  });
  // With email confirmation switched on there is no session yet — the
  // caller shows "check your email" rather than treating it as failure.
  return out.access_token ? store(out) : null;
}

/* Only the owner has an inbox to send anything to. A staff password is
   reset by the owner from Settings → People, not by email. */
export async function sendPasswordReset(email) {
  if (!isOwnerEmail(email)) {
    throw new Error('Ask the owner to set you a new password.');
  }
  await gotrue('/recover', { body: { email: String(email).trim().toLowerCase() } });
}

export async function signOut() {
  const s = loadSession();
  if (s) {
    try { await gotrue('/logout', { token: s.access_token }); } catch {}
  }
  writeSession(null);
  try { localStorage.removeItem(ORG_KEY); } catch {}
}

/**
 * A usable access token, refreshed if it is close to expiry.
 * Returns '' when there is no session or the refresh has been rejected,
 * which the sync layer reads as "stay local for now".
 */
export async function accessToken() {
  if (!cloudConfigured()) return '';
  const s = loadSession();
  if (!s) return '';

  // A minute of slack, so a token cannot expire mid-request.
  if (s.access_token && Date.now() < s.expires_at - 60_000) return s.access_token;
  if (!s.refresh_token) return '';

  // Several callers can want a token at once (a push and a pull racing
  // on reconnect); they share one refresh rather than each spending the
  // refresh token, which GoTrue may rotate.
  if (!refreshing) {
    refreshing = gotrue('/token?grant_type=refresh_token', {
      body: { refresh_token: s.refresh_token },
    })
      .then((out) => store(out))
      .catch((e) => {
        // Only a refusal means the session is really gone. A network
        // failure must leave it alone, or going offline would sign the
        // user out of an app whose whole point is working offline.
        if (e.status === 400 || e.status === 401) writeSession(null);
        return null;
      })
      .finally(() => { refreshing = null; });
  }

  const next = await refreshing;
  return next ? next.access_token : '';
}

/* ── PostgREST ─────────────────────────────────────────────── */

/** A signed-in query against the REST API. Throws on a refused request. */
export async function rest(path, { method = 'GET', body, headers = {} } = {}) {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in');

  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let out = null;
  try { out = text ? JSON.parse(text) : null; } catch { out = text; }

  if (!res.ok) {
    const err = new Error((out && (out.message || out.hint)) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return out;
}

/* ── Organisations ─────────────────────────────────────────── */

export function currentOrgId() {
  try { return localStorage.getItem(ORG_KEY) || ''; } catch { return ''; }
}

export function setCurrentOrg(id) {
  try {
    if (id) localStorage.setItem(ORG_KEY, id);
    else localStorage.removeItem(ORG_KEY);
  } catch {}
}

/**
 * Every org this account belongs to, with the role held in each.
 *
 * Filtered to this user's own id, not just left to RLS. The
 * memberships_read policy deliberately shows every row in any org you
 * belong to — that is what lets the People sheet list your
 * teammates — so an unfiltered select here returns one row per
 * person on the books, not one per org. With a single person on each
 * set of books that was invisible; the moment a second account joins
 * the same org (which is the entire point of Settings → People), it
 * duplicated "Choose books" once per teammate for everyone signed in.
 */
export async function myOrgs() {
  const user = currentUser();
  if (!user) return [];
  const rows = await rest(`/memberships?select=role,org_id,orgs(id,name)&user_id=eq.${user.id}`);
  return (rows || []).map((r) => ({
    id: r.org_id,
    name: (r.orgs && r.orgs.name) || 'Books',
    role: r.role,
  }));
}

/**
 * Checks that the books this device is pointing at still exist and are
 * still ours, and quietly moves to the only remaining set if not.
 *
 * Two sets of books merged into one leaves every device that was on the
 * younger one holding an org id that no longer exists. Nothing would
 * error: sync would ask for that org's rows, be told there are none,
 * and show an empty app forever. So the id is checked once at boot.
 *
 * A failed check is not an answer — offline is the normal state for
 * this app — so it reports `unchecked` and changes nothing.
 */
export async function ensureValidOrg({ timeoutMs = 5000 } = {}) {
  const current = currentOrgId();
  if (!current) return { ok: false, orgs: [] };

  let orgs;
  try {
    orgs = await Promise.race([
      myOrgs(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
  } catch {
    return { ok: true, unchecked: true };
  }

  if ((orgs || []).some((o) => o.id === current)) return { ok: true, orgs };
  if (orgs && orgs.length === 1) {
    setCurrentOrg(orgs[0].id);
    return { ok: true, switched: orgs[0], orgs };
  }
  return { ok: false, orgs: orgs || [] };
}

export async function createOrg(name) {
  // created_by is not sent: a stamp_org_creator trigger sets it from
  // auth.uid() server-side, so there is nothing here that could send a
  // stale or missing id and be refused by row level security for it.
  const rows = await rest('/orgs', {
    method: 'POST',
    body: { name: String(name).trim() || 'Banavat India' },
    headers: { prefer: 'return=representation' },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

/** The role this account holds in the org it is currently looking at. */
export async function myRole(orgId = currentOrgId()) {
  if (!orgId) return '';
  const user = currentUser();
  if (!user) return '';
  const rows = await rest(`/memberships?select=role&org_id=eq.${orgId}&user_id=eq.${user.id}&limit=1`);
  return rows && rows.length ? rows[0].role : '';
}

export function canWrite(role) {
  return ['owner', 'admin', 'staff'].includes(role);
}

/* ── People ────────────────────────────────────────────────
 *
 * There are no invites any more. The owner makes an account outright —
 * a username, a password, and what that person may do — and the staff
 * member signs in with it. Making an account needs the service role,
 * which never comes near a browser, so these calls go to /api/admin/users
 * and it does the work.
 */

export async function members(orgId = currentOrgId()) {
  return rest(`/memberships?select=role,user_id,profiles(email,full_name)&org_id=eq.${orgId}`);
}

/** A signed-in call to one of our own API routes. */
async function adminApi(body) {
  const token = await accessToken();
  if (!token) throw new Error('Not signed in');

  const res = await fetch(api('/api/admin/users'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orgId: currentOrgId(), ...body }),
  });

  const text = await res.text();
  let out = null;
  try { out = text ? JSON.parse(text) : null; } catch { out = null; }
  if (!res.ok) {
    const err = new Error((out && out.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return out;
}

/** Makes the account and puts it straight on these books. */
export async function createStaffAccount({ username, password, fullName = '', role = 'staff' }) {
  return adminApi({ action: 'create', username, password, fullName, role });
}

/** The owner setting someone a new password, in place of a reset email. */
export async function setStaffPassword(userId, password) {
  return adminApi({ action: 'password', userId, password });
}

/** Removes the membership, and the account itself if it is a staff one. */
export async function deleteStaffAccount(userId) {
  return adminApi({ action: 'remove', userId });
}

export async function setRole(userId, role, orgId = currentOrgId()) {
  return rest(`/memberships?org_id=eq.${orgId}&user_id=eq.${userId}`, {
    method: 'PATCH',
    body: { role },
  });
}

export async function removeMember(userId) {
  return deleteStaffAccount(userId);
}
