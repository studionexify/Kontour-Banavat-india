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
