/* db.js — IndexedDB, used only for photo blobs.
   Ledger data lives in store.js (localStorage) so a full backup is one
   JSON file. Photos are binary and can be large, so they get their own
   store and are never inlined into that backup. */

import { migratePhotos } from './legacy.js';

const DB_NAME = 'kontour';
const DB_VER = 1;
const STORE = 'photos';

let _db = null;
let _migrated = null;

/** Opens (and creates) this app's own database, schema and all. */
function openOwn() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('entryId', 'entryId', { unique: false });
        os.createIndex('status', 'status', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Every read and write goes through here, so this is where the old
 * pre-rename database gets emptied into this one — once, before the
 * first query can report a phone's bills as missing.
 */
function open() {
  if (_db) return Promise.resolve(_db);
  if (!_migrated) _migrated = migratePhotos(openOwn);
  return _migrated
    .then(openOwn)
    .then((db) => { _db = db; return db; });
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const os = t.objectStore(STORE);
    let out;
    try { out = fn(os); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqOf(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * A photo record:
 *   { id, entryId, blob, mime, name, w, h, bytes,
 *     status: 'local' | 'queued' | 'uploaded' | 'failed',
 *     driveId, driveLink, extracted, error, createdAt }
 */
export const photos = {
  async put(rec) {
    await tx('readwrite', (os) => os.put(rec));
    return rec;
  },

  async get(id) {
    const db = await open();
    return reqOf(db.transaction(STORE).objectStore(STORE).get(id));
  },

  async byEntry(entryId) {
    const db = await open();
    const idx = db.transaction(STORE).objectStore(STORE).index('entryId');
    return reqOf(idx.getAll(entryId));
  },

  async all() {
    const db = await open();
    return reqOf(db.transaction(STORE).objectStore(STORE).getAll());
  },

  async pending() {
    const all = await photos.all();
    return all.filter((p) => p.status === 'local' || p.status === 'queued' || p.status === 'failed');
  },

  async countPending() {
    return (await photos.pending()).length;
  },

  async patch(id, changes) {
    const rec = await photos.get(id);
    if (!rec) return null;
    const next = { ...rec, ...changes };
    await photos.put(next);
    return next;
  },

  async remove(id) {
    await tx('readwrite', (os) => os.delete(id));
  },

  async removeByEntry(entryId) {
    const list = await photos.byEntry(entryId);
    for (const p of list) await photos.remove(p.id);
  },

  async clear() {
    await tx('readwrite', (os) => os.clear());
  },

  /** Rough total size on device, for Settings. */
  async usage() {
    const all = await photos.all();
    return {
      count: all.length,
      bytes: all.reduce((s, p) => s + (p.bytes || (p.blob && p.blob.size) || 0), 0),
    };
  },
};

/** Object URLs are cached so a re-render does not leak a new URL each time. */
const urlCache = new Map();

export function blobURL(rec) {
  if (!rec || !rec.blob) return '';
  if (urlCache.has(rec.id)) return urlCache.get(rec.id);
  const u = URL.createObjectURL(rec.blob);
  urlCache.set(rec.id, u);
  return u;
}

export function releaseURL(id) {
  if (urlCache.has(id)) {
    URL.revokeObjectURL(urlCache.get(id));
    urlCache.delete(id);
  }
}
