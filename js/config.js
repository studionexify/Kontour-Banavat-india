/* config.js — where this copy of Kontour points.
 *
 * Fill these in after creating the Supabase project (see SETUP.md).
 * Until they are set the app runs exactly as it always has: everything
 * on the device, no account, no sync. Nothing here is a secret — the
 * anon key is designed to be public and is useless without a session,
 * because row level security is what actually guards the data.
 *
 * Committed rather than fetched at boot on purpose. A request for
 * configuration is a request that can fail, and the first thing the app
 * promises is that it opens with no signal.
 */

export const SUPABASE_URL = 'https://bstyhytolniibgqdcpcu.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_FDM5Sk8ooa5534e0jFrcsQ_yFzqKoKr';

/* Where the API routes live. Same origin once the app is on Vercel, so
   this stays empty; set it only if the app and its API are split. */
export const API_BASE = '';

export function cloudConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function api(path) {
  return `${API_BASE}${path}`;
}

/* ── One owner, and the accounts they make ───────────────────
 *
 * These books have a single real account behind an email address:
 * the owner's. Everybody else is made by the owner and signs in with
 * a username and a password, nothing else — no inbox, no invite to
 * accept, no confirmation link to chase on a workshop phone.
 *
 * GoTrue only knows how to authenticate an email address, so a
 * username becomes one: `veer` signs in as `veer@staff.kontour.app`.
 * The domain is never sent anything; it exists so two staff accounts
 * cannot collide with a real address. The app shows the username back
 * and keeps the rest to itself.
 */

export const OWNER_EMAIL = 'furniture@banavat-india.com';
export const STAFF_EMAIL_DOMAIN = 'staff.kontour.app';

/** The characters a username may be made of: a-z, 0-9, dot, dash. */
export function cleanUsername(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

export function isStaffEmail(email) {
  return String(email || '').toLowerCase().endsWith(`@${STAFF_EMAIL_DOMAIN}`);
}

/** Turns what someone typed into the address GoTrue will recognise. */
export function loginEmail(identifier) {
  const raw = String(identifier || '').trim();
  if (raw.includes('@')) return raw.toLowerCase();
  const u = cleanUsername(raw);
  return u ? `${u}@${STAFF_EMAIL_DOMAIN}` : '';
}

/** The other direction: what to show a person about an account. */
export function accountLabel(email) {
  const e = String(email || '');
  return isStaffEmail(e) ? e.slice(0, e.lastIndexOf('@')) : e;
}

export function isOwnerEmail(email) {
  return String(email || '').trim().toLowerCase() === OWNER_EMAIL;
}
