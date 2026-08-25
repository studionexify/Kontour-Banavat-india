/* legacy.js — carrying old installs across the Phynance → Kontour rename.
 *
 * The app used to be called Phynance, and its storage keys were named
 * after it. Renaming them without moving the data would have looked
 * exactly like a fresh install to anyone who already had a ledger on
 * their phone: no entries, no PIN, signed out.
 *
 * So the keys are renamed and the data comes with them. Both halves run
 * once and then cost nothing.
 *
 * This file can be deleted once no device is running a build older than
 * the rename — realistically a year. Nothing else imports from it except
 * for the side effect of loading it.
 */

const DONE_KEY = 'kontour.migrated';

const LOCAL_KEYS = [
  ['phynance.v1', 'kontour.v1'],                 // the ledger itself
  ['phynance.device', 'kontour.device'],         // PIN skip, install hints
  ['phynance.session', 'kontour.session'],       // the signed-in session
  ['phynance.org', 'kontour.org'],               // which books
  ['phynance.outbox', 'kontour.outbox'],         // changes not yet pushed
  ['phynance.cursor', 'kontour.cursor'],         // how far the last pull got
];

/* Runs at import time, before any module that imports this one reads a
   key — ES modules evaluate a dependency fully before its importer. */
(function migrateLocalStorage() {
  try {
    if (localStorage.getItem(DONE_KEY)) return;
    for (const [from, to] of LOCAL_KEYS) {
      const value = localStorage.getItem(from);
      // Never overwrite: if something already wrote the new key, that is
      // the newer truth and the old one is a leftover.
      if (value !== null && localStorage.getItem(to) === null) {
        localStorage.setItem(to, value);
      }
      if (value !== null) localStorage.removeItem(from);
    }
    localStorage.setItem(DONE_KEY, String(Date.now()));
  } catch {
    // A browser with storage disabled has nothing to migrate anyway.
  }
})();

/* ── Photos ────────────────────────────────────────────────────
   IndexedDB cannot be renamed, so the records are copied across.
   Deliberately cautious, because these are the only copies of a bill
   that has not reached Drive yet: the old database is deleted only
   after every record is readable in the new one, and a failure part
   way through leaves the old one alone and simply tries again on the
   next launch. */

const OLD_DB = 'phynance';
const STORE = 'photos';

function openIfExists(name, version) {
  return new Promise((resolve) => {
    let existed = true;
    const req = indexedDB.open(name, version);
    // Fires only when the database is being created, which tells us it
    // was not there — the one reliable way to ask across browsers.
    req.onupgradeneeded = () => { existed = false; };
    req.onsuccess = () => {
      const db = req.result;
      if (!existed || !db.objectStoreNames.contains(STORE)) {
        db.close();
        indexedDB.deleteDatabase(name);
        resolve(null);
        return;
      }
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function readAll(db) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function writeAll(db, records) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const os = t.objectStore(STORE);
    for (const r of records) os.put(r);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/**
 * Moves photo records out of the old database, if there are any.
 * `openNew` is db.js's own opener, so the new database is created by
 * the code that owns its schema rather than by a second definition
 * here that could drift from it.
 */
export async function migratePhotos(openNew) {
  try {
    if (localStorage.getItem(`${DONE_KEY}.photos`)) return;

    const old = await openIfExists(OLD_DB, 1);
    if (!old) {
      localStorage.setItem(`${DONE_KEY}.photos`, 'none');
      return;
    }

    const records = await readAll(old);
    old.close();

    if (records.length) {
      const next = await openNew();
      await writeAll(next, records);
      // Read back before dropping the only other copy.
      const check = await readAll(next);
      if (check.length < records.length) {
        throw new Error('photo copy came back short');
      }
    }

    indexedDB.deleteDatabase(OLD_DB);
    localStorage.setItem(`${DONE_KEY}.photos`, String(records.length));
  } catch (e) {
    // Left for the next launch. The old database is untouched, so the
    // bills are still there either way.
    console.warn('[kontour] photo migration deferred', e);
  }
}
