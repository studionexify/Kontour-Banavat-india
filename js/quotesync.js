/* quotesync.js — quotations on the shared books.
 *
 * The same bargain the ledger makes in cloud.js: the device decides,
 * the server agrees later. Every write lands locally first; sync pushes
 * what has changed and pulls what is new. Nothing here can block a
 * save, and every entry point returns rather than throws, because a
 * failed sync is a normal state for this app and not an error.
 *
 * It is a separate file from cloud.js rather than a fifth kind inside
 * it because the two stores are separate: the ledger's outbox reads
 * store.js state, and threading a second shape through it would put
 * the books at risk for the sake of not writing this file.
 *
 * Security is not implemented here. It is implemented in the database —
 * every row carries org_id, every policy asks whether you are a member,
 * and the anon key the app ships with has been revoked from these
 * tables outright. This file cannot grant itself access it does not
 * have; the worst a tampered client achieves is a refused request.
 */

import { cloudConfigured } from './config.js';
import { rest, accessToken, currentOrgId, signedIn, myRole, canWrite } from './auth.js';
import {
  syncRecords, applyRemote, sharedSettings, updateSettings,
  SHARED_QUOTE_SETTINGS, load as loadQuotes, claimFor,
} from './quotes.js';

const CURSOR_KEY = 'kontour.quotes.cursor';
const SENT_KEY = 'kontour.quotes.sent';
const PAGE = 500;

let syncing = null;
let lastError = '';
let role = '';

export function ready() {
  return cloudConfigured() && signedIn() && Boolean(currentOrgId());
}

export function online() {
  return navigator.onLine !== false;
}

export function lastSyncError() { return lastError; }

/* ── What this device has already sent ──────────────────────
   A stamp per record rather than a queue of changes. The store is
   small and rewritten wholesale on every edit, so asking "what looks
   different from what the server last confirmed" is both simpler and
   more honest than trying to catch each mutation as it happens — a
   change made by an import, a restore, or a future screen is caught
   the same way as one made by a form. */

function readSent() {
  try { return JSON.parse(localStorage.getItem(SENT_KEY) || '{}'); } catch (e) { return {}; }
}

function writeSent(map) {
  try { localStorage.setItem(SENT_KEY, JSON.stringify(map)); } catch (e) { /* full disk */ }
}

function cursor() {
  try { return localStorage.getItem(CURSOR_KEY) || ''; } catch (e) { return ''; }
}

function setCursor(v) {
  try { localStorage.setItem(CURSOR_KEY, v || ''); } catch (e) { /* full disk */ }
}

/** Forgets everything this device knows about the server's copy, so the
    next sync pulls the org's quotations from the beginning. Used when
    switching orgs, where the cursor belongs to the books just left. */
export function resetQuoteSync() {
  setCursor('');
  writeSent({});
  role = '';
}

export function refreshRole() { role = ''; }

/* ── Push ──────────────────────────────────────────────────── */

async function push(orgId) {
  const sent = readSent();
  const mine = syncRecords();

  const changes = mine
    .filter((r) => sent[`${r.kind}:${r.id}`] !== r.updatedAt)
    .map((r) => ({
      org_id: orgId,
      kind: r.kind,
      id: r.id,
      data: r.data,
      updated_at: r.updatedAt,
      deleted_at: r.deletedAt,
    }));

  if (!changes.length) return { pushed: 0 };

  // A viewer's write would be refused row by row by RLS and arrive as
  // an opaque failure. Better to know the answer before asking.
  if (!canWrite(role)) return { pushed: 0, readOnly: true };

  let pushed = 0;
  // Batched, because a first upload of a whole history is one request
  // otherwise and a phone on a workshop connection will not finish it.
  for (let i = 0; i < changes.length; i += PAGE) {
    const slice = changes.slice(i, i + PAGE);
    const applied = await rest('/rpc/push_records', { method: 'POST', body: { changes: slice } });

    // Only what the server confirms is marked as sent. Anything that
    // lost to a newer server copy is left unmarked, and the pull below
    // brings that newer copy down instead.
    for (const r of applied || []) {
      const local = slice.find((c) => c.kind === r.kind && c.id === r.id);
      if (local) sent[`${r.kind}:${r.id}`] = local.updated_at;
      pushed += 1;
    }
  }

  writeSent(sent);
  return { pushed, rejected: changes.length - pushed };
}

/* ── Pull ──────────────────────────────────────────────────── */

async function pull(orgId) {
  const since = cursor();
  const filter = since ? `&updated_at=gt.${encodeURIComponent(since)}` : '';
  const rows = await rest(
    `/records?select=kind,id,data,updated_at,deleted_at&org_id=eq.${orgId}`
    + `&kind=in.(quote,design)${filter}&order=updated_at.asc&limit=${PAGE}`
  );

  if (!rows || !rows.length) return { pulled: 0 };

  const changed = applyRemote(rows);

  // Whatever came down is, by definition, what the server holds — so
  // mark it sent, or the next push would send the server its own rows
  // straight back.
  const sent = readSent();
  for (const r of rows) sent[`${r.kind}:${r.id}`] = Date.parse(r.updated_at) || 0;
  writeSent(sent);

  // The cursor moves to the newest row seen, not to now: a row written
  // while this request was in flight would otherwise be skipped forever.
  setCursor(rows[rows.length - 1].updated_at);

  if (rows.length >= PAGE) {
    const more = await pull(orgId);
    return { pulled: changed + more.pulled };
  }
  return { pulled: changed };
}

/* ── Shared settings ────────────────────────────────────────
   The boilerplate every quotation prints — the terms, the bank
   details, the logo — belongs to the business rather than to the
   device that happened to type it. It rides in org_settings under its
   own key so it cannot collide with the ledger's. */

async function syncSettings(orgId) {
  const rows = await rest(`/org_settings?select=data&org_id=eq.${orgId}&limit=1`);
  const remote = rows && rows.length ? (rows[0].data || {}) : null;
  const mine = sharedSettings();

  if (remote === null || remote.quotation === undefined) {
    if (!canWrite(role)) return;
    await rest('/org_settings', {
      method: 'POST',
      body: { org_id: orgId, data: { ...(remote || {}), quotation: mine } },
      headers: { prefer: 'resolution=merge-duplicates' },
    });
    return;
  }

  // What the books say wins. These are settled once and rarely touched,
  // and a wrong guess is visible on the next quotation and one tap to
  // put right.
  const theirs = remote.quotation || {};
  const patch = {};
  for (const k of SHARED_QUOTE_SETTINGS) {
    if (theirs[k] !== undefined && JSON.stringify(theirs[k]) !== JSON.stringify(mine[k])) {
      patch[k] = theirs[k];
    }
  }
  if (Object.keys(patch).length) updateSettings(patch);
}

/* ── The one entry point ───────────────────────────────────── */

export function syncQuotes({ settingsToo = false } = {}) {
  if (syncing) return syncing;

  syncing = (async () => {
    if (!ready()) return { skipped: 'not signed in' };
    if (!online()) return { skipped: 'offline' };

    const token = await accessToken();
    if (!token) return { skipped: 'session expired' };

    const orgId = currentOrgId();

    // Before a single row moves: are these this org's quotations at
    // all? If the device was last used for different books, they are
    // cleared rather than uploaded into somebody else's.
    if (claimFor(orgId)) {
      setCursor('');
      writeSent({});
      role = '';
    }

    try {
      if (!role) role = await myRole(orgId);
      const up = await push(orgId);
      const down = await pull(orgId);
      if (settingsToo) await syncSettings(orgId);
      lastError = '';
      return { ...up, ...down };
    } catch (e) {
      lastError = e.message || 'Sync failed';
      return { error: lastError };
    }
  })().finally(() => { syncing = null; });

  return syncing;
}

/* ── Keeping in step ───────────────────────────────────────── */

let started = false;

export function startQuoteSync({ onChange } = {}) {
  if (started) return;
  started = true;

  const run = async (opts) => {
    const r = await syncQuotes(opts);
    if (onChange && (r.pulled || r.pushed)) onChange(r);
    return r;
  };

  window.addEventListener('online', () => run());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
  // The same slow backstop the ledger uses. Deliberately not a realtime
  // subscription: a socket held open on a phone in a workshop spends
  // battery reporting news about a book that changes a few times a day.
  setInterval(() => run(), 5 * 60 * 1000);

  run({ settingsToo: true });
}

/**
 * Everything this device holds, offered as a first upload.
 *
 * Signing in on a device that already has quotations is the one case
 * the stamps cannot describe: the records are real and unsent, but
 * they were written before there was anywhere to send them. Clearing
 * the stamps makes every one of them look new again.
 */
export async function adoptLocalQuotes() {
  loadQuotes();
  writeSent({});
  return syncQuotes({ settingsToo: true });
}
