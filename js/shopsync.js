/* shopsync.js — the shop floor and the commission book, shared.
 *
 * The ledger has cloud.js and the quotations have quotesync.js; the
 * production line and the commission book had nothing, which is why a
 * piece moved to Assembly on the workshop phone was invisible on the
 * office laptop and a partner added in the office never reached the
 * floor. This is the same pump for the two stores that were left out.
 *
 * The bargain is the one the other two make: the device decides, the
 * server agrees later. Every write already landed locally before
 * anything here runs, nothing here can block a save, and every entry
 * point returns rather than throws — a failed sync is a normal state
 * for this app, not an error.
 *
 * Three kinds ride the same records table the rest of the app uses —
 * `order`, `partner`, `commission` — so the row level security that
 * guards the books guards these too, with no new policy to get wrong.
 * They are added to the enum by supabase/migrations/0004_shop_kinds.sql;
 * a project that has not run it yet gets a legible message rather than
 * a broken ledger, because this file's requests are its own.
 */

import { cloudConfigured } from './config.js';
import { rest, accessToken, currentOrgId, signedIn, myRole, canWrite } from './auth.js';
import * as orders from './orders.js';
import * as commissions from './commissions.js';
import * as subs from './subs.js';

const CURSOR_KEY = 'kontour.shop.cursor';
const SYNCED_KEY = 'kontour.shop.synced';
const SENT_KEY = 'kontour.shop.sent';
const PAGE = 500;

/* Which store owns which kind. One list, so pushing and pulling can
   never disagree about where a row belongs. */
const STORES = [
  { mod: orders, kinds: ['order'] },
  { mod: commissions, kinds: ['partner', 'commission'] },
  // Named by 0006. `optional` is what stops a database that has not
  // been taught these labels yet from taking the whole sync down with
  // them: the four are dropped from the push and the pull, and the
  // ledger, the orders and the quotations carry on. See push().
  { mod: subs, kinds: ['sub', 'subwo', 'subitem', 'subpay'], optional: true },
];
const KINDS = STORES.flatMap((s) => s.kinds);
const OPTIONAL_KINDS = new Set(STORES.filter((s) => s.optional).flatMap((s) => s.kinds));

/* What this database will actually accept. Everything, until a push
   comes back saying otherwise. */
function liveKinds() {
  return unsupported ? KINDS.filter((k) => !OPTIONAL_KINDS.has(k)) : KINDS;
}

let syncing = null;
let lastError = '';
let unsupported = false;   // the migration has not been run on this project
let role = '';

export function ready() {
  return cloudConfigured() && signedIn() && Boolean(currentOrgId());
}

export function online() {
  return navigator.onLine !== false;
}

export function lastSyncError() { return lastError; }

/** True when the database does not know these kinds yet — the one
    failure a user can do something about (run the migration). */
export function needsMigration() { return unsupported; }

/* ── What this device has already sent ─────────────────────────
   A stamp per record rather than a queue of changes: both stores are
   rewritten wholesale on every edit, so asking "what looks different
   from what the server last confirmed" catches an import or a restore
   the same way it catches a form. */

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

/** Forgets what this device knows about the server's copy, so the next
    sync fetches the org's shop floor from the beginning. */
export function resetShopSync() {
  setCursor('');
  writeSent({});
  try { localStorage.removeItem(SYNCED_KEY); } catch (e) { /* full disk */ }
  role = '';
  unsupported = false;
}

export function refreshRole() { role = ''; }

/**
 * Whether this device may seed the historical orders and partners it
 * ships with. On a device that is not on shared books, always: the
 * seed is that device's only copy. On shared books, only once a pull
 * has actually landed — otherwise a phone that signs in and opens the
 * dashboard before the first sync finishes would seed a second copy of
 * a history the books already hold, stamped now, and push it over
 * everybody else's edits.
 */
export function seedingAllowed() {
  if (!ready()) return true;
  // A completed sync, not a cursor. The cursor only moves when rows
  // come down, so keying off it would mean books that are genuinely
  // empty — a brand new org — never got the seed at all, because the
  // pull that proved them empty left the cursor where it was.
  try { return localStorage.getItem(SYNCED_KEY) === '1'; } catch (e) { return false; }
}

/* An enum the project has not been taught yet comes back from
   PostgREST as an invalid-input error on the cast. Naming it is worth
   more than a retry loop that can never succeed. */
function isUnknownKind(e) {
  const m = String((e && e.message) || '').toLowerCase();
  return m.includes('invalid input value for enum') || m.includes('record_kind');
}

/* ── Push ──────────────────────────────────────────────────── */

async function push(orgId) {
  const sent = readSent();
  const mine = [];
  for (const { mod } of STORES) mine.push(...mod.syncRecords());

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

  try {
    return await send(changes.filter((c) => !unsupported || !OPTIONAL_KINDS.has(c.kind)), sent);
  } catch (e) {
    // The database does not know one of these labels. That is a
    // migration nobody has run yet, not a reason to strand the
    // ledger: drop what it cannot store and send the rest.
    if (!isUnknownKind(e) || unsupported) throw e;
    unsupported = true;
    const kept = changes.filter((c) => !OPTIONAL_KINDS.has(c.kind));
    const held = changes.length - kept.length;
    if (!kept.length) return { pushed: 0, held };
    return { ...(await send(kept, sent)), held };
  }
}

/** The batched write itself, separated so it can be retried with a
    narrower set of kinds without rebuilding what changed. */
async function send(changes, sent) {
  let pushed = 0;
  // Batched, because a first upload of a whole production history is
  // one request otherwise and a phone on a workshop connection will
  // not finish it.
  for (let i = 0; i < changes.length; i += PAGE) {
    const slice = changes.slice(i, i + PAGE);
    const applied = await rest('/rpc/push_records', { method: 'POST', body: { changes: slice } });

    // Only what the server confirms is marked as sent. Anything that
    // lost to a newer server copy stays unmarked, and the pull below
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
    + `&kind=in.(${liveKinds().join(',')})${filter}&order=updated_at.asc&limit=${PAGE}`
  );

  if (!rows || !rows.length) return { pulled: 0 };

  let changed = 0;
  for (const { mod } of STORES) changed += mod.applyRemote(rows);

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

/* ── The one entry point ───────────────────────────────────── */

export function syncShop() {
  if (syncing) return syncing;

  syncing = (async () => {
    if (!ready()) return { skipped: 'not signed in' };
    if (!online()) return { skipped: 'offline' };

    const token = await accessToken();
    if (!token) return { skipped: 'session expired' };

    const orgId = currentOrgId();

    // Before a single row moves: is this work these books' at all? If
    // the device was last used for different books it is cleared
    // rather than uploaded into somebody else's.
    let cleared = false;
    for (const { mod } of STORES) cleared = mod.claimFor(orgId) || cleared;
    if (cleared) resetShopSync();

    // The pull names every kind in its filter, so a database that has
    // not learned one of them rejects the read as well as the write —
    // and a device with nothing to push would otherwise never get past
    // it. One retry with the optional kinds dropped covers both.
    const attempt = async () => {
      const up = await push(orgId);
      const down = await pull(orgId);
      return { ...up, ...down };
    };

    try {
      if (!role) role = await myRole(orgId);
      // Re-probed every cycle: the moment the migration is applied the
      // optional kinds start flowing again with nothing to reset.
      unsupported = false;

      let res;
      try {
        res = await attempt();
      } catch (e) {
        if (!isUnknownKind(e) || unsupported) throw e;
        unsupported = true;
        res = await attempt();
      }

      lastError = unsupported
        ? 'The database has not been taught the sub-contractor kinds yet — run supabase/migrations/0006_subcontractor_kinds.sql. Everything else is syncing.'
        : '';
      // This device has now seen what the books hold, empty or not.
      try { localStorage.setItem(SYNCED_KEY, '1'); } catch (e) { /* full disk */ }
      return res;
    } catch (e) {
      if (isUnknownKind(e)) {
        unsupported = true;
        lastError = 'The database has not been taught these record kinds yet — run the migrations in supabase/migrations/.';
      } else {
        lastError = e.message || 'Sync failed';
      }
      return { error: lastError };
    }
  })().finally(() => { syncing = null; });

  return syncing;
}

/* ── Keeping in step ───────────────────────────────────────── */

let started = false;

export function startShopSync({ onChange } = {}) {
  if (started) return;
  started = true;

  const run = async () => {
    const r = await syncShop();
    if (onChange && (r.pulled || r.pushed)) onChange(r);
    return r;
  };

  window.addEventListener('online', () => run());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
  setInterval(() => run(), 5 * 60 * 1000);

  run();
}

/**
 * Everything this device holds, offered as a first upload.
 *
 * Signing in on a device that already has a production history is the
 * one case the stamps cannot describe: the records are real and
 * unsent, but they were written before there was anywhere to send
 * them. Clearing the stamps makes every one of them look new again —
 * and because each carries its own updatedAt, an older copy still
 * loses to whatever the server already holds.
 */
export async function adoptLocalShop() {
  writeSent({});
  return syncShop();
}
