/* outbox.js — what this device has changed and not yet pushed.
 *
 * Changes are derived by diffing, not reported by hand. Every mutation
 * in store.js already funnels through one commit(), so comparing the
 * state it is about to write against the last one it wrote produces the
 * change list for free — and cannot drift the way twenty-five hand-
 * placed calls to a track() helper eventually would. It also catches
 * the writes that skip commit(), like ensureJob's silent path, on the
 * next commit that does happen.
 *
 * The queue is keyed by record, not appended to. Editing the same entry
 * six times offline should push once, carrying the sixth version.
 */

const QUEUE_KEY = 'phynance.outbox';
const CURSOR_KEY = 'phynance.cursor';

/* The five kinds that sync, and what each one calls its identity.
   Jobs are keyed by code; everything else by id. Settings sync
   separately — see cloud.js — because most of that object is
   device-local and must never leave. */
export const KINDS = [
  { kind: 'account', arr: 'accounts', key: 'id' },
  { kind: 'category', arr: 'categories', key: 'id' },
  { kind: 'job', arr: 'jobs', key: 'code' },
  { kind: 'entry', arr: 'entries', key: 'id' },
  { kind: 'recurring', arr: 'recurring', key: 'id' },
];

export function keyOf(kind, id) {
  return `${kind}:${id}`;
}

/* ── Snapshot ──────────────────────────────────────────────── */

/**
 * A comparable picture of the synced parts of state: kind → id → JSON.
 * Serialising each record is what makes "did this change" a string
 * compare rather than a deep walk, and the strings are what get pushed.
 */
export function snapshot(state) {
  const out = {};
  for (const { kind, arr, key } of KINDS) {
    const map = new Map();
    for (const rec of state[arr] || []) {
      const id = rec[key];
      if (id == null || id === '') continue;
      map.set(String(id), JSON.stringify(rec));
    }
    out[kind] = map;
  }
  return out;
}

/**
 * What changed between two snapshots, as records ready to push.
 * `live` is the current state, so a changed record can be stamped with
 * the updatedAt that both this device and the server will sort by.
 */
export function diff(before, after, live) {
  const changes = [];
  const now = Date.now();

  for (const { kind, arr, key } of KINDS) {
    const prev = (before && before[kind]) || new Map();
    const next = after[kind] || new Map();
    const byId = new Map((live[arr] || []).map((r) => [String(r[key]), r]));

    for (const [id, json] of next) {
      if (prev.get(id) === json) continue;          // untouched
      const rec = byId.get(id);
      if (!rec) continue;

      // Stamped on the record itself, not just the change, so the local
      // copy and the pushed copy agree on when this version was written.
      // Entries already carry updatedAt from their own edit path; only
      // an unchanged one would be overwritten here, and it did change.
      rec.updatedAt = now;
      changes.push({ kind, id, data: rec, updatedAt: now, deletedAt: null });
    }

    for (const id of prev.keys()) {
      if (next.has(id)) continue;
      // A tombstone, not a DELETE. Another device that has been offline
      // still holds this row; without a dated deletion to compare
      // against, its next push would put the row straight back.
      changes.push({ kind, id, data: { [key]: id, deleted: true }, updatedAt: now, deletedAt: now });
    }
  }

  return changes;
}

/* ── Queue ─────────────────────────────────────────────────── */

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {}
}

export function enqueue(changes) {
  if (!changes || !changes.length) return;
  const q = readQueue();
  for (const c of changes) {
    // Straight replace: the newest version of a record is the only one
    // worth sending, and a delete supersedes whatever came before it.
    q[keyOf(c.kind, c.id)] = c;
  }
  writeQueue(q);
}

/** Everything waiting, oldest change first. */
export function queued() {
  const q = readQueue();
  return Object.values(q).sort((a, b) => a.updatedAt - b.updatedAt);
}

export function queuedCount() {
  return Object.keys(readQueue()).length;
}

/**
 * Drops the changes that made it, leaving anything edited mid-push.
 * The updatedAt check is what makes that safe: if the record was
 * touched again while the request was in flight, its queue entry now
 * carries a newer stamp than the one that was sent, and it stays.
 */
export function resolve(sent) {
  if (!sent || !sent.length) return;
  const q = readQueue();
  for (const c of sent) {
    const k = keyOf(c.kind, c.id);
    if (q[k] && q[k].updatedAt <= c.updatedAt) delete q[k];
  }
  writeQueue(q);
}

export function clearQueue() {
  writeQueue({});
}

/* ── Pull cursor ───────────────────────────────────────────── */

export function cursor() {
  try { return localStorage.getItem(CURSOR_KEY) || ''; } catch { return ''; }
}

export function setCursor(iso) {
  try {
    if (iso) localStorage.setItem(CURSOR_KEY, iso);
    else localStorage.removeItem(CURSOR_KEY);
  } catch {}
}
