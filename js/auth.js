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

import { SUPABASE_URL, SUPABASE_ANON_KEY, cloudConfigured } from './config.js';
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

export async function signIn(email, password) {
  const out = await gotrue('/token?grant_type=password', {
    body: { email: String(email).trim(), password },
  });
  return store(out);
}

export async function signUp(email, password, fullName = '') {
  const out = await gotrue('/signup', {
    body: {
      email: String(email).trim(),
      password,
      data: { full_name: fullName },
    },
  });
  // With email confirmation switched on there is no session yet — the
  // caller shows "check your email" rather than treating it as failure.
  return out.access_token ? store(out) : null;
}

export async function sendPasswordReset(email) {
  await gotrue('/recover', { body: { email: String(email).trim() } });
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

/** Every org this account belongs to, with the role held in each. */
export async function myOrgs() {
  const rows = await rest('/memberships?select=role,org_id,orgs(id,name)');
  return (rows || []).map((r) => ({
    id: r.org_id,
    name: (r.orgs && r.orgs.name) || 'Books',
    role: r.role,
  }));
}

export async function createOrg(name) {
  const user = currentUser();
  const rows = await rest('/orgs', {
    method: 'POST',
    body: { name: String(name).trim() || 'Banavat India', created_by: user ? user.id : null },
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

/* ── People ────────────────────────────────────────────────── */

export async function members(orgId = currentOrgId()) {
  return rest(`/memberships?select=role,user_id,profiles(email,full_name)&org_id=eq.${orgId}`);
}

export async function invite(email, role = 'staff', orgId = currentOrgId()) {
  return rest('/invites', {
    method: 'POST',
    body: { org_id: orgId, email: String(email).trim().toLowerCase(), role },
    headers: { prefer: 'return=representation' },
  });
}

export async function pendingInvites(orgId = currentOrgId()) {
  return rest(`/invites?select=id,email,role,created_at&org_id=eq.${orgId}&accepted_at=is.null`);
}

export async function revokeInvite(id) {
  return rest(`/invites?id=eq.${id}`, { method: 'DELETE' });
}

export async function setRole(userId, role, orgId = currentOrgId()) {
  return rest(`/memberships?org_id=eq.${orgId}&user_id=eq.${userId}`, {
    method: 'PATCH',
    body: { role },
  });
}

export async function removeMember(userId, orgId = currentOrgId()) {
  return rest(`/memberships?org_id=eq.${orgId}&user_id=eq.${userId}`, { method: 'DELETE' });
}
