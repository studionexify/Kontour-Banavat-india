/* cloud.js — the ledger, shared.
 *
 * Offline-first is the whole premise, so the shape is: the device
 * decides, the server agrees later. Every write lands in localStorage
 * first and goes into the outbox; sync pushes what is queued and pulls
 * what changed since the last cursor. Nothing here can block a save,
 * and every entry point returns rather than throws — a failed sync is a
 * normal state for this app, not an error.
 *
 * Conflicts are settled by last write wins, per record, in the database
 * (see push_records in the migration) rather than here, so two devices
 * pushing at the same moment cannot interleave into a lost update.
 * Per record matters: two people editing different entries in the same
 * minute both keep their work, which is the case that actually happens.
 */

import { cloudConfigured } from './config.js';
import {
  accessToken, rest, currentOrgId, signedIn, myRole, canWrite,
} from './auth.js';
import {
  queued, queuedCount, resolve, cursor, setCursor, prune, KINDS,
} from './outbox.js';
import { applyRemote, settings, saveSettings, load } from './store.js';

/* Settings split in two. These are the books' settings and belong to
   everyone; everything else in the object is this device's business —
   the PIN hash and salt, the Drive token, any API key — and must never
   be sent anywhere. */
const SHARED_SETTINGS = ['gstDefaultRate', 'gstDefaultMode'];

let syncing = null;             // in-flight sync, so callers coalesce
let lastError = '';
let role = '';

export function online() {
  return navigator.onLine !== false;
}

export function ready() {
  return cloudConfigured() && signedIn() && Boolean(currentOrgId());
}

export function pendingCount() {
  return queuedCount();
}

export function lastSyncError() {
  return lastError;
}

/* ── Push ──────────────────────────────────────────────────── */

async function push(orgId) {
  const batch = queued();
  if (!batch.length) return { pushed: 0 };

  // A viewer's push would be refused row by row by RLS and surface as an
  // opaque failure. Better to know the answer before asking.
  if (!canWrite(role)) return { pushed: 0, readOnly: true };

  const changes = batch.map((c) => ({
    org_id: orgId,
    kind: c.kind,
    id: String(c.id),
    data: c.data,
    updated_at: c.updatedAt,
    deleted_at: c.deletedAt,
  }));

  const applied = await rest('/rpc/push_records', {
    method: 'POST',
    body: { changes },
  });

  // Only what the server confirms is dropped from the queue. A record
  // that lost to a newer server copy is not in the result; it stays
  // queued for a moment and then the pull below overwrites it locally,
  // at which point its queue entry is stale and the next resolve drops
  // it. Either way nothing is lost silently.
  const ok = (applied || []).map((r) => ({
    kind: r.kind,
    id: r.id,
    updatedAt: Date.parse(r.updated_at) || Date.now(),
  }));
  resolve(ok);

  return { pushed: ok.length, rejected: batch.length - ok.length };
}

/* ── Pull ──────────────────────────────────────────────────── */

async function pull(orgId) {
  const since = cursor();
  const filter = since ? `&updated_at=gt.${encodeURIComponent(since)}` : '';
  // Filtered to the ledger's own kinds. Unfiltered, this page also
  // carried the quotations, the designs and the production line —
  // every row of which store.js discards — so a phone paid for
  // downloading the whole app's history to sync five kinds of it.
  const kinds = KINDS.map((k) => k.kind).join(',');
  const rows = await rest(
    `/records?select=kind,id,data,updated_at,deleted_at&org_id=eq.${orgId}`
    + `&kind=in.(${kinds})${filter}&order=updated_at.asc&limit=2000`
  );

  if (!rows || !rows.length) return { pulled: 0 };

  const changed = applyRemote(rows);

  // The cursor moves to the newest row seen, not to now: a row written
  // while this request was in flight would otherwise be skipped forever.
  setCursor(rows[rows.length - 1].updated_at);

  // A full page probably means there is more behind it.
  if (rows.length >= 2000) {
    const more = await pull(orgId);
    return { pulled: changed + more.pulled };
  }
  return { pulled: changed };
}

/* ── Shared settings ───────────────────────────────────────── */

async function syncSettings(orgId) {
  const local = settings();
  const mine = {};
  for (const k of SHARED_SETTINGS) mine[k] = local[k];

  const rows = await rest(`/org_settings?select=data,updated_at&org_id=eq.${orgId}&limit=1`);
  const remote = rows && rows.length ? (rows[0].data || {}) : null;

  if (remote === null) {
    await rest('/org_settings', {
      method: 'POST',
      body: { org_id: orgId, data: mine },
      headers: { prefer: 'resolution=merge-duplicates' },
    });
    return;
  }

  // No stamp per field, so the rule is simply: what the books say wins,
  // unless this device has nothing yet. These are two rarely-touched
  // numbers, and a wrong guess is visible and one tap to fix.
  const differs = SHARED_SETTINGS.some((k) => remote[k] !== undefined && remote[k] !== mine[k]);
  if (differs) {
    const patch = {};
    for (const k of SHARED_SETTINGS) if (remote[k] !== undefined) patch[k] = remote[k];
    saveSettings(patch);
  }
}

/* ── The one entry point ───────────────────────────────────── */

/**
 * Push what is waiting, then pull what is new.
 * Safe to call often and from anywhere: concurrent calls share one run,
 * and it resolves to a result object rather than throwing.
 */
export function sync({ settingsToo = false } = {}) {
  if (syncing) return syncing;

  syncing = (async () => {
    if (!ready()) return { skipped: 'not signed in' };
    if (!online()) return { skipped: 'offline' };

    const orgId = currentOrgId();
    const token = await accessToken();
    if (!token) return { skipped: 'session expired' };

    try {
      if (!role) role = await myRole(orgId);
      const up = await push(orgId);
      const down = await pull(orgId);
      // Anything the pull answered with a newer copy has lost and is
      // dropped, rather than queued for a push that can only be refused.
      prune(load());
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

/** Forgets what this device knows about the server, so the next sync
    fetches the org's books from the beginning. Used after switching
    orgs, where the cursor belongs to the org that was left behind. */
export function resetSyncState() {
  setCursor('');
  role = '';
}

export function refreshRole() {
  role = '';
}

/* ── Keeping in step ───────────────────────────────────────── */

let started = false;

/**
 * Syncs when there is a reason to: on reconnect, when the tab is looked
 * at again, and on a slow timer as a backstop. Deliberately not a
 * realtime subscription — a socket held open on a phone in a workshop
 * costs battery to deliver news about a ledger that changes a few times
 * a day.
 */
export function startSync({ onChange } = {}) {
  if (started) return;
  started = true;

  const run = async (opts) => {
    const r = await sync(opts);
    if (onChange && (r.pulled || r.pushed)) onChange(r);
    return r;
  };

  window.addEventListener('online', () => run());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
  setInterval(() => run(), 5 * 60 * 1000);

  run({ settingsToo: true });
}

/**
 * Everything this device holds, pushed as a first upload.
 *
 * Signing in on a device that already has books is the one case the
 * cursor cannot describe: the records are real and unsynced, but the
 * outbox is empty because they were written before there was anywhere
 * to send them. Every record is queued, tombstones aside.
 *
 * Each keeps its own stamp rather than being restamped as new. That is
 * what makes this safe to run on a device that is not the first one
 * in: push_records settles by last write wins per row, so a local copy
 * that is genuinely older loses to what the books already hold instead
 * of overwriting a colleague's newer edit with a stale one.
 */
export async function adoptLocalData() {
  const s = load();
  const { enqueue } = await import('./outbox.js');
  const changes = [];

  for (const { kind, arr, key } of KINDS) {
    for (const rec of s[arr] || []) {
      const id = rec[key];
      if (id == null || id === '') continue;
      changes.push({
        kind,
        id: String(id),
        data: rec,
        // A record with no stamp of its own predates the stamping and
        // is treated as the oldest thing on the books, which is what
        // it is.
        updatedAt: rec.updatedAt || rec.createdAt || 1,
        deletedAt: null,
      });
    }
  }

  enqueue(changes);
  return sync({ settingsToo: true });
}
