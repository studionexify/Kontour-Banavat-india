/* google.js — an access token for the business's Drive folder.
 *
 * Two credential modes, because which one works depends on the account
 * the folder lives in:
 *
 *   refresh token   A normal Google account (including plain Gmail)
 *                   consents once; files are owned by that account and
 *                   count against its storage. Set GOOGLE_CLIENT_ID,
 *                   GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.
 *
 *   service account A Workspace Shared Drive with the service account
 *                   added as a member; files are owned by the Shared
 *                   Drive. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and
 *                   GOOGLE_PRIVATE_KEY.
 *
 * The trap this exists to avoid: a service account has no Drive storage
 * of its own, so pointing one at a folder in a consumer account fails
 * on quota the first time a bill is uploaded, not at setup. If both
 * modes are configured the refresh token wins, because it is the one
 * that works everywhere.
 */

import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';

/* An access token lasts an hour. A warm serverless instance handles
   many uploads, so caching one saves a round trip on most of them. */
let cached = { token: '', exp: 0 };

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function viaRefreshToken() {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Google refused the refresh token (${res.status})`);
  return res.json();
}

async function viaServiceAccount() {
  // Vercel's dashboard stores newlines in a multi-line secret as the two
  // characters \ and n, which breaks PEM parsing in a way that only shows
  // up as an opaque signing error.
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const iat = Math.floor(Date.now() / 1000);
  const claim = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key);
  const assertion = `${unsigned}.${b64url(sig)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Google refused the service account (${res.status})`);
  return res.json();
}

export function driveConfigured() {
  return Boolean(
    (process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    || (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY)
  );
}

export async function accessToken() {
  if (cached.token && Date.now() < cached.exp) return cached.token;

  const useRefresh = Boolean(process.env.GOOGLE_REFRESH_TOKEN);
  const out = useRefresh ? await viaRefreshToken() : await viaServiceAccount();

  cached = {
    token: out.access_token,
    // A minute of slack, so a token cannot expire mid-upload.
    exp: Date.now() + Math.max(0, (out.expires_in || 3600) - 60) * 1000,
  };
  return cached.token;
}

/* ── Drive calls ──────────────────────────────────────────── */

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

/* Shared Drives are invisible to the v3 API unless every call opts in. */
const SHARED = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

async function driveFetch(url, options = {}) {
  const token = await accessToken();
  const res = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Drive ${res.status}: ${detail.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/** Finds or creates `name` inside `parentId`, and returns its id. */
export async function ensureFolder(name, parentId) {
  const q = [
    `name='${name.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    `mimeType='${FOLDER_MIME}'`,
    'trashed=false',
  ].join(' and ');

  const found = await driveFetch(
    `${FILES}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&${SHARED}`
  ).then((r) => r.json());
  if (found.files && found.files.length) return found.files[0].id;

  const made = await driveFetch(`${FILES}?fields=id&${SHARED}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  }).then((r) => r.json());
  return made.id;
}

/**
 * Uploads one file and returns { id, link }.
 * Multipart rather than resumable: bills are downscaled on the device
 * before they get here, and a resumable session would cost two more
 * round trips for a file that fits in one.
 */
export async function uploadFile({ name, mimeType, bytes, parentId }) {
  const boundary = `kontour${crypto.randomUUID()}`;
  const meta = JSON.stringify({ name, parents: [parentId] });

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const out = await driveFetch(
    `${UPLOAD}?uploadType=multipart&fields=id,webViewLink&${SHARED}`,
    {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    }
  ).then((r) => r.json());

  return { id: out.id, link: out.webViewLink || '' };
}

/** Streams a file's bytes back, for showing a bill in the app. */
export async function downloadFile(fileId) {
  const res = await driveFetch(`${FILES}/${encodeURIComponent(fileId)}?alt=media&${SHARED}`);
  return {
    mimeType: res.headers.get('content-type') || 'application/octet-stream',
    bytes: Buffer.from(await res.arrayBuffer()),
  };
}
