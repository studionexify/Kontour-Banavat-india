/* sync.js — the online half: bills go to Google Drive, and Claude reads
   them back into the entry fields.
 *
 * Both halves are fully written but dormant until credentials are entered
 * in Settings. Offline, photos simply queue on the device and nothing here
 * runs — every call below checks `configured` first.
 *
 * Raw fetch rather than the Anthropic SDK on purpose: this is a no-build
 * vanilla PWA, so there is no npm step to install a package with.
 */

import { photos, toBase64 } from './photos.js';
import { settings, saveSettings, getEntry, categories } from './store.js';
import { dmy } from './format.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'; // only files this app creates
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export function online() {
  return navigator.onLine !== false;
}

export function driveConfigured() {
  const d = settings().drive;
  return !!(d && d.clientId);
}

export function driveAuthed() {
  const d = settings().drive;
  return !!(d && d.token && d.tokenExp > Date.now() + 30000);
}

export function aiConfigured() {
  const a = settings().ai;
  return !!(a && a.enabled && (a.key || a.endpoint));
}

/* ── Google Drive ──────────────────────────────────────────── */

let gisPromise = null;

function loadGIS() {
  if (window.google && window.google.accounts) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not reach Google. Check the internet connection.'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

/** Opens Google's consent popup and stores the resulting access token. */
export async function connectDrive() {
  const d = settings().drive;
  if (!d.clientId) throw new Error('Add a Google client ID in Settings first.');
  if (!online()) throw new Error('You are offline — connect when you have internet.');
  await loadGIS();

  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: d.clientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        saveSettings({
          drive: {
            ...settings().drive,
            token: resp.access_token,
            tokenExp: Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000,
          },
        });
        resolve(true);
      },
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export function disconnectDrive() {
  saveSettings({ drive: { ...settings().drive, token: '', tokenExp: 0, folderId: '' } });
}

async function driveFetch(url, options = {}) {
  const d = settings().drive;
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${d.token}`, ...(options.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) {
    saveSettings({ drive: { ...settings().drive, token: '', tokenExp: 0 } });
    throw new Error('Google sign-in expired — reconnect in Settings.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive error ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

async function findOrCreateFolder(name, parentId = null) {
  const q = [
    `name='${name.replace(/'/g, "\\'")}'`,
    `mimeType='${FOLDER_MIME}'`,
    'trashed=false',
    parentId ? `'${parentId}' in parents` : null,
  ].filter(Boolean).join(' and ');

  const found = await driveFetch(`${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`);
  if (found.files && found.files.length) return found.files[0].id;

  const created = await driveFetch(`${DRIVE_FILES}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return created.id;
}

/** /Phynance/2026/08 — created once, then remembered. */
async function folderFor(dateISO) {
  const d = settings().drive;
  const rootName = d.folderName || 'Phynance';
  let rootId = d.folderId;
  if (!rootId) {
    rootId = await findOrCreateFolder(rootName);
    saveSettings({ drive: { ...settings().drive, folderId: rootId } });
  }
  const year = String(dateISO).slice(0, 4);
  const month = String(dateISO).slice(5, 7);
  const yId = await findOrCreateFolder(year, rootId);
  return findOrCreateFolder(month, yId);
}

/** B109_2026-08-19_45000.jpg — readable straight out of the Drive listing. */
function fileNameFor(entry, rec) {
  const bits = [];
  if (entry && entry.jobCode) bits.push(entry.jobCode);
  bits.push(entry ? entry.date : new Date().toISOString().slice(0, 10));
  if (entry) bits.push(String(Math.round(entry.total)));
  if (entry && entry.party) bits.push(entry.party.replace(/[^\w-]+/g, '-').slice(0, 24));
  return `${bits.join('_') || rec.id}.jpg`;
}

export async function uploadPhoto(rec) {
  if (!driveAuthed()) throw new Error('Google Drive is not connected.');
  const entry = rec.entryId ? getEntry(rec.entryId) : null;
  const parent = await folderFor(entry ? entry.date : new Date().toISOString().slice(0, 10));

  const metadata = {
    name: fileNameFor(entry, rec),
    parents: [parent],
    description: entry
      ? `Phynance ${entry.type} · ${dmy(entry.date)} · ₹${entry.total}${entry.note ? ' · ' + entry.note : ''}`
      : 'Phynance bill',
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', rec.blob, metadata.name);

  const out = await driveFetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    body: form,
  });

  await photos.patch(rec.id, {
    status: 'uploaded',
    driveId: out.id,
    driveLink: out.webViewLink || '',
    error: '',
  });
  return out;
}

/* ── Claude — read the bill ────────────────────────────────── */

const EXTRACT_PROMPT = `You are reading a photographed Indian bill, invoice, receipt or payment screenshot for a furniture manufacturing workshop.

Return ONLY a JSON object, no prose and no code fence, with these keys:
{
  "amount": number | null,          // the grand total actually payable, in rupees
  "base": number | null,            // taxable value before GST, if shown
  "gstAmount": number | null,       // total GST/CGST+SGST/IGST, if shown
  "gstRate": number | null,         // 0, 5, 12, 18 or 28
  "gstInclusive": true | false | null, // true if the total already contains GST
  "date": "YYYY-MM-DD" | null,      // bill date; Indian bills are usually DD/MM/YYYY
  "party": string | null,           // the other party's name (vendor, shop, client)
  "invoiceNo": string | null,
  "direction": "in" | "out" | null, // "out" if we are paying, "in" if we are receiving
  "categoryGuess": string | null,   // best match from the category list below
  "particulars": string | null,     // one short line describing what it was for
  "confidence": "high" | "medium" | "low"
}

Rules:
- Use null for anything not clearly legible. Never invent a number.
- Amounts are plain numbers: 1,88,630.00 becomes 188630.
- If both a taxable value and a total are shown, "amount" is the total.
- "particulars" must be under 60 characters.`;

function categoryList() {
  return categories().map((c) => `${c.name} (${c.type === 'in' ? 'money in' : 'money out'})`).join(', ');
}

function extractJSON(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

/**
 * Sends the photo to Claude and returns the fields it could read.
 * Nothing is saved from this — the values land in the form for review.
 */
export async function readBill(rec) {
  const a = settings().ai;
  if (!aiConfigured()) throw new Error('Add an API key in Settings to read bills automatically.');
  if (!online()) throw new Error('Reading a bill needs internet.');

  const b64 = await toBase64(rec.blob);
  const body = {
    model: a.model || 'claude-opus-5',
    max_tokens: 2000,
    // A receipt read is a short, mechanical extraction — low effort keeps it
    // quick and cheap. Thinking is left at the model default (adaptive).
    output_config: { effort: 'low' },
    // Server-side fallback: if a safety classifier ever declines, the same
    // request is re-run on a fallback model inside the same call.
    fallbacks: 'default',
    system: `${EXTRACT_PROMPT}\n\nCategories in use: ${categoryList()}`,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: 'Read this bill and return the JSON.' },
      ],
    }],
  };

  // An endpoint set in Settings means "go through my server" — that is the
  // right shape once Phynance is on the subdomain, because the API key then
  // lives server-side instead of in this browser.
  const useProxy = !!a.endpoint;
  const url = useProxy ? a.endpoint : ANTHROPIC_URL;
  const headers = { 'content-type': 'application/json' };
  if (!useProxy) {
    headers['x-api-key'] = a.key;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    // Required for calling the API straight from a browser.
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('That API key was rejected.');
    if (res.status === 429) throw new Error('Rate limited — try again in a moment.');
    throw new Error(`Read failed (${res.status}): ${text.slice(0, 160)}`);
  }

  const json = await res.json();
  if (json.stop_reason === 'refusal') {
    throw new Error('The model declined to read that image.');
  }
  const text = (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJSON(text);
  if (!parsed) throw new Error('Could not make sense of that bill — enter it manually.');

  const out = {
    ...parsed,
    _usage: json.usage ? { in: json.usage.input_tokens, out: json.usage.output_tokens } : null,
    _model: json.model || body.model,
    _at: Date.now(),
  };
  await photos.patch(rec.id, { extracted: out });
  return out;
}

/* ── The queue ─────────────────────────────────────────────── */

let running = false;

/**
 * Uploads everything waiting, one at a time. Safe to call on every app
 * open and whenever the connection returns — it no-ops when it can't work.
 */
export async function syncPending(onProgress) {
  if (running) return { skipped: true };
  if (!online() || !driveAuthed()) return { skipped: true };
  running = true;
  const pending = await photos.pending();
  let done = 0, failed = 0;
  try {
    for (const rec of pending) {
      try {
        await uploadPhoto(rec);
        done++;
      } catch (e) {
        failed++;
        await photos.patch(rec.id, { status: 'failed', error: String(e.message || e) });
      }
      if (onProgress) onProgress(done + failed, pending.length);
    }
  } finally {
    running = false;
  }
  return { done, failed, total: pending.length };
}

/** Human-readable state for the Home strip and Settings. */
export async function status() {
  const pending = await photos.pending();
  return {
    online: online(),
    drive: driveConfigured() ? (driveAuthed() ? 'connected' : 'needs sign-in') : 'not set up',
    ai: aiConfigured() ? 'ready' : 'not set up',
    pending: pending.length,
  };
}

export function watchConnection(fn) {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
}
