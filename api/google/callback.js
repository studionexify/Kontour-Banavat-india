/* GET /api/google/callback — the other half of the one-time consent.
 *
 * Exchanges the code for a refresh token and shows it once, alongside
 * the folders in that Drive so the folder id can be copied at the same
 * time rather than hunted for in an address bar afterwards.
 *
 * The token is shown, never stored. Nothing on this deployment can
 * write an environment variable, and a route that could would be a
 * worse idea than a page you copy from once.
 */

import { checkState, redirectUri, setupBlocked, esc, page } from '../_lib/setup.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function foldersIn(token) {
  const q = `mimeType='${FOLDER_MIME}' and trashed=false`;
  const url = `${FILES}?q=${encodeURIComponent(q)}`
    + '&fields=files(id,name,parents)&pageSize=60&orderBy=name'
    + '&supportsAllDrives=true&includeItemsFromAllDrives=true';
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const out = await res.json();
  return out.files || [];
}

export default async function handler(req, res) {
  const blocked = setupBlocked();
  if (blocked) return res.status(403).json({ error: blocked });

  const { code, state, error } = req.query || {};

  if (error) {
    return res.status(400).send(page('Not connected', `
      <h1>Google said no</h1>
      <p>The consent screen came back with <code>${esc(error)}</code>.</p>
      <p>The usual cause is signing in as an account that is not the one
         owning the Drive folder. Start again from
         <code>/api/google/connect?secret=…</code>.</p>`));
  }

  if (!checkState(process.env.SETUP_SECRET, state)) {
    return res.status(403).send(page('Expired', `
      <h1>That link has expired</h1>
      <p>The setup link is good for ten minutes. Start again from
         <code>/api/google/connect?secret=…</code>.</p>`));
  }

  if (!code) return res.status(400).json({ error: 'No code returned' });

  let tokens;
  try {
    const out = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    tokens = await out.json();
    if (!out.ok) throw new Error(tokens.error_description || tokens.error || `HTTP ${out.status}`);
  } catch (e) {
    return res.status(502).send(page('Exchange failed', `
      <h1>Could not exchange the code</h1>
      <pre>${esc(e.message)}</pre>
      <p>If this says <code>redirect_uri_mismatch</code>, add exactly this
         to the OAuth client's authorised redirect URIs in Google Cloud
         Console:</p>
      <pre>${esc(redirectUri(req))}</pre>`));
  }

  if (!tokens.refresh_token) {
    return res.status(400).send(page('No refresh token', `
      <h1>Google returned no refresh token</h1>
      <p>That happens when this account has already granted consent, so
         Google reissues an access token only. Remove Kontour from
         <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">
         your account's third-party access</a> and run the connect link
         again.</p>`));
  }

  let folders = [];
  try { folders = await foldersIn(tokens.access_token); } catch {}

  const rows = folders.length
    ? folders.map((f) => `<tr><td>${esc(f.name)}</td><td><code>${esc(f.id)}</code></td></tr>`).join('')
    : '<tr><td colspan="2">No folders found in this Drive.</td></tr>';

  return res.status(200).send(page('Drive connected', `
    <h1><span class="ok">Connected.</span> Two values to copy.</h1>
    <p>This page shows the refresh token once and does not store it.
       Put both into the Vercel environment variables, then redeploy.</p>

    <h2>GOOGLE_REFRESH_TOKEN</h2>
    <pre>${esc(tokens.refresh_token)}</pre>

    <h2>DRIVE_ROOT_FOLDER_ID</h2>
    <p>Pick the folder bills should go into, or make one in Drive and
       run this again.</p>
    <table>${rows}</table>

    <div class="warn">
      When both are set, delete <code>SETUP_SECRET</code> from the Vercel
      environment. That closes these two routes again.
    </div>`));
}
