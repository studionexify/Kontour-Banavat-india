/* views/settings.js — accounts, categories, recurring, the PIN, the online
   credentials, and backup. Opened from the gear on Home. */

import { icon } from '../icons.js';
import { openSheet, on, esc, toast, confirmSheet, emptyState } from '../ui.js';
import {
  accounts, addAccount, updateAccount, deleteAccount, balance,
  categories, addCategory, updateCategory, deleteCategory,
  recurring, addRecurring, updateRecurring, deleteRecurring,
  settings, saveSettings, hasPin, setPin, clearPin, device,
  importAll, wipe, seedSample, entries,
} from '../store.js';
import { inr } from '../format.js';
import { photos, humanBytes } from '../photos.js';
import { exportBackup, readBackupFile } from '../export.js';
import { status, connectDrive, disconnectDrive, driveConfigured, syncPending } from '../sync.js';

export function openSettings(ctx) {
  const sheet = openSheet({
    title: 'Settings',
    full: true,
    body: `<div class="sheet-body" data-body></div>`,
    async onMount(root) {
      const body = root.querySelector('[data-body]');
      await paint();

      async function paint() {
        const s = settings();
        const sync = await status();
        const usage = await photos.usage();
        body.innerHTML = `
          <p class="tray-lbl">Money</p>
          <div class="list">
            ${navRow('wallet', 'Accounts', `${accounts().length} · ${inr(accounts().reduce((n, a) => n + balance(a.id), 0))} in hand`, 'accounts')}
            ${navRow('tag', 'Categories', `${categories('in').length} in · ${categories('out').length} out`, 'categories')}
            ${navRow('repeat', 'Recurring entries', recurring().length ? `${recurring().length} set up` : 'Rent, salaries, anything monthly', 'recurring')}
            ${navRow('note', 'GST default', `${s.gstDefaultRate}% · ${s.gstDefaultMode === 'incl' ? 'GST inside the amount' : 'GST on top'}`, 'gst')}
          </div>

          <p class="tray-lbl sp">Online</p>
          <div class="list">
            ${navRow('drive', 'Google Drive', driveLabel(sync), 'drive')}
            ${navRow('sparkle', 'Read bills with Claude', s.ai.enabled && (s.ai.key || s.ai.endpoint) ? `On · ${s.ai.model}` : 'Not set up', 'ai')}
            ${navRow(sync.online ? 'cloud' : 'cloudOff', 'Pending uploads',
              sync.pending ? `${sync.pending} waiting · ${humanBytes(usage.bytes)} stored` : 'Nothing waiting', 'pending')}
          </div>

          <p class="tray-lbl sp">This device</p>
          <div class="list">
            ${navRow('lock', 'PIN lock', hasPin() ? (device.get('skipPin') ? 'On, skipped on this device' : 'On') : 'Off', 'pin')}
            ${navRow('download', 'Backup & restore', `${entries().length} entries`, 'backup')}
            ${navRow('alert', 'About Phynance', 'Version, storage, reset', 'about')}
          </div>

          ${!entries().length ? `
            <button class="btn sec sm" data-seed>Add a sample week to look around</button>` : ''}
        `;
      }

      on(root, '[data-nav]', async (e, b) => {
        const where = b.dataset.nav;
        const map = {
          accounts: accountsSheet, categories: categoriesSheet, recurring: recurringSheet,
          gst: gstSheet, drive: driveSheet, ai: aiSheet, pending: pendingSheet,
          pin: pinSheet, backup: backupSheet, about: aboutSheet,
        };
        await map[where](ctx, paint);
      });

      on(root, '[data-seed]', async () => {
        const ok = await confirmSheet({
          title: 'Add sample entries?',
          message: 'Seven entries from a typical week get added so you can see how everything works. Delete them any time from the ledger.',
          confirmLabel: 'Add them',
        });
        if (!ok) return;
        seedSample();
        toast('Sample week added');
        await paint();
        ctx.refresh();
      });
    },
    onClose() { ctx.refresh(); },
  });
  return sheet;
}

function navRow(ico, title, sub, nav) {
  return `
    <button class="row" data-nav="${nav}">
      <span class="row-ico">${icon(ico, 18)}</span>
      <span class="row-txt">
        <span class="row-t">${esc(title)}</span>
        <span class="row-s">${esc(sub)}</span>
      </span>
      <span class="row-go">${icon('chevR', 17)}</span>
    </button>`;
}

function driveLabel(sync) {
  if (sync.drive === 'connected') return 'Connected';
  if (sync.drive === 'needs sign-in') return 'Set up — needs sign-in';
  return 'Not set up';
}

/* ── Accounts ──────────────────────────────────────────────── */

function accountsSheet(ctx, back) {
  const sheet = openSheet({
    title: 'Accounts',
    body: `<div class="sheet-body" data-b></div>`,
    onMount(root) {
      const b = root.querySelector('[data-b]');
      paint();
      function paint() {
        b.innerHTML = `
          <div class="list">
            ${accounts(true).map((a) => `
              <button class="row" data-edit="${a.id}">
                <span class="row-ico">${icon(a.icon || 'wallet', 18)}</span>
                <span class="row-txt">
                  <span class="row-t">${esc(a.name)}${a.archived ? ' · hidden' : ''}</span>
                  <span class="row-s">opening ${esc(inr(a.opening))}</span>
                </span>
                <span class="row-amt num">${esc(inr(balance(a.id)))}</span>
              </button>`).join('')}
          </div>
          <button class="btn sm" data-add>${icon('plus', 15)} Add account</button>
          <div class="hint" style="margin-top:10px">
            An account is also the payment mode — Cash, Bank and UPI are how your sheets already record it.
            Set the opening balance once and the running total stays true.
          </div>`;
      }

      on(root, '[data-add]', () => editAccount(null, () => { paint(); back(); ctx.refresh(); }));
      on(root, '[data-edit]', (e, el) => editAccount(el.dataset.edit, () => { paint(); back(); ctx.refresh(); }));
    },
  });
  return sheet;
}

function editAccount(id, done) {
  const a = id ? accounts(true).find((x) => x.id === id) : null;
  const icons = ['cash', 'bank', 'phone', 'wallet', 'user', 'box'];
  const sheet = openSheet({
    title: a ? a.name : 'New account',
    body: `
      <div class="sheet-body">
        <div class="field">
          <label>Name</label>
          <input class="control" data-name value="${esc(a ? a.name : '')}" placeholder="Bank — HDFC">
        </div>
        <div class="field">
          <label>Opening balance (₹)</label>
          <input class="control num" data-open type="number" inputmode="decimal" value="${a ? a.opening : 0}">
          <div class="hint">What was in it before you started logging here.</div>
        </div>
        <div class="field">
          <label>Icon</label>
          <div class="catgrid">
            ${icons.map((i) => `<button class="cat ${a && a.icon === i ? 'on' : ''}" data-ic="${i}">${icon(i, 18)}</button>`).join('')}
          </div>
        </div>
        <button class="btn" data-save>${a ? 'Save account' : 'Add account'}</button>
        ${a ? `<button class="btn danger sm" data-del>Remove account</button>` : ''}
      </div>`,
    onMount(root) {
      let chosen = a ? (a.icon || 'wallet') : 'wallet';
      on(root, '[data-ic]', (e, el) => {
        chosen = el.dataset.ic;
        root.querySelectorAll('[data-ic]').forEach((x) => x.classList.toggle('on', x.dataset.ic === chosen));
      });
      on(root, '[data-save]', () => {
        const name = root.querySelector('[data-name]').value.trim();
        const opening = Number(root.querySelector('[data-open]').value || 0);
        if (!name) { toast('Give it a name', 'warn'); return; }
        if (a) updateAccount(a.id, { name, opening, icon: chosen });
        else addAccount({ name, opening, icon: chosen });
        toast('Saved');
        sheet.close();
        done();
      });
      on(root, '[data-del]', async () => {
        const ok = await confirmSheet({
          title: `Remove ${a.name}?`,
          message: 'If any entries use it, the account is hidden instead of deleted — no entry is ever removed.',
          confirmLabel: 'Remove', danger: true,
        });
        if (!ok) return;
        deleteAccount(a.id);
        toast('Removed');
        sheet.close();
        done();
      });
    },
  });
}

/* ── Categories ────────────────────────────────────────────── */

function categoriesSheet(ctx, back) {
  let side = 'out';
  const sheet = openSheet({
    title: 'Categories',
    body: `<div class="sheet-body" data-b></div>`,
    onMount(root) {
      const b = root.querySelector('[data-b]');
      paint();
      function paint() {
        b.innerHTML = `
          <div class="toggle2" style="margin-bottom:14px">
            <button data-side="out" class="${side === 'out' ? 'on' : ''}">Money out</button>
            <button data-side="in" class="${side === 'in' ? 'on' : ''}">Money in</button>
          </div>
          <div class="list">
            ${categories(side, true).map((c) => `
              <button class="row" data-edit="${c.id}">
                <span class="row-ico ${side}">${icon(c.icon || 'note', 18)}</span>
                <span class="row-txt"><span class="row-t">${esc(c.name)}${c.archived ? ' · hidden' : ''}</span></span>
                <span class="row-go">${icon('edit', 16)}</span>
              </button>`).join('')}
          </div>
          <button class="btn sm" data-add>${icon('plus', 15)} Add ${side === 'out' ? 'expense' : 'income'} category</button>`;
      }
      on(root, '[data-side]', (e, el) => { side = el.dataset.side; paint(); });
      on(root, '[data-add]', () => editCategory(null, side, () => { paint(); back(); }));
      on(root, '[data-edit]', (e, el) => editCategory(el.dataset.edit, side, () => { paint(); back(); }));
    },
  });
}

function editCategory(id, type, done) {
  const c = id ? categories(null, true).find((x) => x.id === id) : null;
  const sheet = openSheet({
    title: c ? c.name : 'New category',
    body: `
      <div class="sheet-body">
        <div class="field">
          <label>Name</label>
          <input class="control" data-name value="${esc(c ? c.name : '')}" placeholder="Polishing & finishing">
        </div>
        ${c ? `
          <div class="switchrow" data-arch>
            <div><div class="sw-t">Hide from the entry screen</div>
            <div class="sw-s">Past entries keep it</div></div>
            <div class="switch ${c.archived ? 'on' : ''}"></div>
          </div>` : ''}
        <button class="btn" data-save>${c ? 'Save' : 'Add category'}</button>
        ${c ? `<button class="btn danger sm" data-del>Delete category</button>` : ''}
      </div>`,
    onMount(root) {
      let archived = c ? !!c.archived : false;
      on(root, '[data-arch]', (e, el) => {
        archived = !archived;
        el.querySelector('.switch').classList.toggle('on', archived);
      });
      on(root, '[data-save]', () => {
        const name = root.querySelector('[data-name]').value.trim();
        if (!name) { toast('Give it a name', 'warn'); return; }
        if (c) updateCategory(c.id, { name, archived });
        else addCategory({ name, type });
        toast('Saved');
        sheet.close();
        done();
      });
      on(root, '[data-del]', async () => {
        const ok = await confirmSheet({
          title: `Delete ${c.name}?`,
          message: 'If entries already use it, it is hidden instead — no entry loses its category.',
          confirmLabel: 'Delete', danger: true,
        });
        if (!ok) return;
        deleteCategory(c.id);
        sheet.close();
        done();
      });
    },
  });
}

/* ── Recurring ─────────────────────────────────────────────── */

function recurringSheet(ctx, back) {
  const sheet = openSheet({
    title: 'Recurring entries',
    body: `<div class="sheet-body" data-b></div>`,
    onMount(root) {
      const b = root.querySelector('[data-b]');
      paint();
      function paint() {
        const list = recurring();
        b.innerHTML = `
          ${list.length ? `<div class="list">
            ${list.map((r) => `
              <button class="row" data-edit="${r.id}">
                <span class="row-ico">${icon('repeat', 18)}</span>
                <span class="row-txt">
                  <span class="row-t">${esc(r.label)}</span>
                  <span class="row-s">day ${r.day} · ${esc(inr(r.template.entered || 0))}${r.active ? '' : ' · paused'}</span>
                </span>
                <span class="row-go">${icon('chevR', 17)}</span>
              </button>`).join('')}
          </div>` : emptyState('repeat', 'Nothing recurring yet', 'Rent, salaries, EMIs — anything that repeats monthly')}
          <button class="btn sm" data-add>${icon('plus', 15)} Add a monthly entry</button>
          <div class="hint" style="margin-top:10px">
            On the due day, Home shows a prompt with the figures filled in.
            Nothing is ever written to the ledger until you tap save.
          </div>`;
      }
      on(root, '[data-add]', () => editRecurring(null, () => { paint(); back(); }));
      on(root, '[data-edit]', (e, el) => editRecurring(el.dataset.edit, () => { paint(); back(); }));
    },
  });
}

function editRecurring(id, done) {
  const r = id ? recurring().find((x) => x.id === id) : null;
  const tpl = r ? r.template : { type: 'out', entered: 0, categoryId: '', accountId: '', party: '', note: '' };
  const sheet = openSheet({
    title: r ? r.label : 'New recurring entry',
    body: `
      <div class="sheet-body">
        <div class="field">
          <label>Name it</label>
          <input class="control" data-label value="${esc(r ? r.label : '')}" placeholder="Workshop rent">
        </div>
        <div class="field-2">
          <div class="field">
            <label>Amount (₹)</label>
            <input class="control num" data-amt type="number" inputmode="decimal" value="${tpl.entered || ''}">
          </div>
          <div class="field">
            <label>Day of month</label>
            <input class="control num" data-day type="number" min="1" max="28" value="${r ? r.day : 1}">
          </div>
        </div>
        <div class="field">
          <label>Type</label>
          <div class="toggle2">
            <button data-type="out" class="${tpl.type !== 'in' ? 'on' : ''}">Money out</button>
            <button data-type="in" class="${tpl.type === 'in' ? 'on' : ''}">Money in</button>
          </div>
        </div>
        <div class="field">
          <label>Category</label>
          <select class="control" data-cat></select>
        </div>
        <div class="field">
          <label>Account</label>
          <select class="control" data-acc>
            ${accounts().map((a) => `<option value="${a.id}" ${tpl.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Party</label>
          <input class="control" data-party value="${esc(tpl.party || '')}" placeholder="Landlord">
        </div>
        ${r ? `<div class="switchrow" data-active>
          <div><div class="sw-t">Active</div><div class="sw-s">Pause without deleting</div></div>
          <div class="switch ${r.active ? 'on' : ''}"></div>
        </div>` : ''}
        <button class="btn" data-save>${r ? 'Save' : 'Add recurring entry'}</button>
        ${r ? `<button class="btn danger sm" data-del>Delete</button>` : ''}
      </div>`,
    onMount(root) {
      let type = tpl.type === 'in' ? 'in' : 'out';
      let active = r ? r.active : true;
      const catSel = root.querySelector('[data-cat]');

      function fillCats() {
        catSel.innerHTML = categories(type)
          .map((c) => `<option value="${c.id}" ${tpl.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
      }
      fillCats();

      on(root, '[data-type]', (e, el) => {
        type = el.dataset.type;
        root.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('on', x.dataset.type === type));
        fillCats();
      });
      on(root, '[data-active]', (e, el) => {
        active = !active;
        el.querySelector('.switch').classList.toggle('on', active);
      });

      on(root, '[data-save]', () => {
        const label = root.querySelector('[data-label]').value.trim();
        const entered = Number(root.querySelector('[data-amt]').value || 0);
        const day = Number(root.querySelector('[data-day]').value || 1);
        if (!label) { toast('Give it a name', 'warn'); return; }
        const template = {
          type,
          entered,
          categoryId: catSel.value,
          accountId: root.querySelector('[data-acc]').value,
          party: root.querySelector('[data-party]').value.trim(),
          note: label,
        };
        if (r) updateRecurring(r.id, { label, day, template, active });
        else addRecurring({ label, day, template });
        toast('Saved');
        sheet.close();
        done();
      });

      on(root, '[data-del]', async () => {
        const ok = await confirmSheet({ title: `Delete ${r.label}?`, message: 'Entries already logged from it are not affected.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        deleteRecurring(r.id);
        sheet.close();
        done();
      });
    },
  });
}

/* ── GST default ───────────────────────────────────────────── */

function gstSheet(ctx, back) {
  const s = settings();
  const sheet = openSheet({
    title: 'GST default',
    body: `
      <div class="sheet-body">
        <div class="field">
          <label>Default rate</label>
          <select class="control" data-rate>
            ${[0, 5, 12, 18, 28].map((r) => `<option value="${r}" ${r === s.gstDefaultRate ? 'selected' : ''}>${r}%</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>When you type an amount, it is</label>
          <div class="toggle2">
            <button data-mode="excl" class="${s.gstDefaultMode === 'excl' ? 'on' : ''}">Before GST</button>
            <button data-mode="incl" class="${s.gstDefaultMode === 'incl' ? 'on' : ''}">GST inside</button>
          </div>
          <div class="hint">Only the starting position — you can flip it on any entry.</div>
        </div>
        <button class="btn" data-save>Save</button>
      </div>`,
    onMount(root) {
      let mode = s.gstDefaultMode;
      on(root, '[data-mode]', (e, el) => {
        mode = el.dataset.mode;
        root.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === mode));
      });
      on(root, '[data-save]', () => {
        saveSettings({ gstDefaultRate: Number(root.querySelector('[data-rate]').value), gstDefaultMode: mode });
        toast('Saved');
        sheet.close();
        back();
      });
    },
  });
}

/* ── Google Drive ──────────────────────────────────────────── */

function driveSheet(ctx, back) {
  const s = settings();
  const sheet = openSheet({
    title: 'Google Drive',
    body: `
      <div class="sheet-body">
        <div class="hint" style="margin-bottom:14px">
          Bills are uploaded to a folder you own, sorted into
          <b>${esc(s.drive.folderName || 'Phynance')}/2026/08/</b>. Phynance only ever sees the files it
          creates itself — it cannot read the rest of your Drive.
        </div>
        <div class="field">
          <label>Google OAuth client ID</label>
          <input class="control" data-cid value="${esc(s.drive.clientId)}" placeholder="…apps.googleusercontent.com">
          <div class="hint">From Google Cloud Console → Credentials → OAuth client → Web application.
          Add this app's address to the allowed JavaScript origins.</div>
        </div>
        <div class="field">
          <label>Folder name</label>
          <input class="control" data-folder value="${esc(s.drive.folderName || 'Phynance')}">
        </div>
        <button class="btn sm" data-save>Save</button>
        <button class="btn ${driveConfigured() ? '' : 'sec'} sm" data-connect>Connect Google account</button>
        ${s.drive.token ? `<button class="btn sec sm" data-disc>Disconnect</button>` : ''}
        <div class="hint" style="margin-top:14px">
          Until this is connected, bills stay on the phone and are marked as waiting. Nothing is lost.
        </div>
      </div>`,
    onMount(root) {
      on(root, '[data-save]', () => {
        saveSettings({
          drive: {
            ...settings().drive,
            clientId: root.querySelector('[data-cid]').value.trim(),
            folderName: root.querySelector('[data-folder]').value.trim() || 'Phynance',
            folderId: '',
          },
        });
        toast('Saved');
        back();
      });
      on(root, '[data-connect]', async () => {
        try {
          await connectDrive();
          toast('Google Drive connected');
          const r = await syncPending();
          if (r.done) toast(`${r.done} bill${r.done > 1 ? 's' : ''} uploaded`);
          sheet.close();
          back();
        } catch (e) {
          toast(String(e.message || e), 'err', 3600);
        }
      });
      on(root, '[data-disc]', () => {
        disconnectDrive();
        toast('Disconnected');
        sheet.close();
        back();
      });
    },
  });
}

/* ── Claude ────────────────────────────────────────────────── */

function aiSheet(ctx, back) {
  const s = settings();
  const models = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
  const sheet = openSheet({
    title: 'Read bills with Claude',
    body: `
      <div class="sheet-body">
        <div class="hint" style="margin-bottom:14px">
          When a bill photo is added and you are online, Claude reads it and fills in the amount,
          date, party, GST and a one-line description. Nothing is saved until you check it and tap save.
        </div>
        <div class="switchrow" data-en>
          <div><div class="sw-t">Read bills automatically</div><div class="sw-s">Only when online</div></div>
          <div class="switch ${s.ai.enabled ? 'on' : ''}"></div>
        </div>
        <div class="field">
          <label>Anthropic API key</label>
          <input class="control" data-key type="password" value="${esc(s.ai.key)}" placeholder="sk-ant-…">
          <div class="hint warn">
            The key is stored in this browser and sent straight from the phone. That is fine for your own
            device; once Phynance is on the subdomain, move it behind your server using the field below
            so the key never reaches a browser.
          </div>
        </div>
        <div class="field">
          <label>Model</label>
          <select class="control" data-model>
            ${models.map((m) => `<option value="${m}" ${s.ai.model === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Server endpoint (optional)</label>
          <input class="control" data-ep value="${esc(s.ai.endpoint || '')}" placeholder="https://phynance.…/api/read-bill">
          <div class="hint">Set this later and the key above is ignored — the request goes to your server instead.</div>
        </div>
        <button class="btn" data-save>Save</button>
      </div>`,
    onMount(root) {
      let enabled = s.ai.enabled;
      on(root, '[data-en]', (e, el) => {
        enabled = !enabled;
        el.querySelector('.switch').classList.toggle('on', enabled);
      });
      on(root, '[data-save]', () => {
        saveSettings({
          ai: {
            ...settings().ai,
            enabled,
            key: root.querySelector('[data-key]').value.trim(),
            model: root.querySelector('[data-model]').value,
            endpoint: root.querySelector('[data-ep]').value.trim(),
          },
        });
        toast('Saved');
        sheet.close();
        back();
      });
    },
  });
}

/* ── Pending uploads ───────────────────────────────────────── */

function pendingSheet(ctx, back) {
  const sheet = openSheet({
    title: 'Pending uploads',
    body: `<div class="sheet-body" data-b></div>`,
    async onMount(root) {
      const b = root.querySelector('[data-b]');
      await paint();
      async function paint() {
        const pending = await photos.pending();
        const usage = await photos.usage();
        const sync = await status();
        b.innerHTML = `
          <div class="list" style="padding:2px 14px;margin-bottom:14px">
            <div class="kv"><span>Waiting to upload</span><b>${pending.length}</b></div>
            <div class="kv"><span>Photos on this device</span><b>${usage.count} · ${humanBytes(usage.bytes)}</b></div>
            <div class="kv"><span>Connection</span><b>${sync.online ? 'Online' : 'Offline'}</b></div>
            <div class="kv"><span>Drive</span><b>${esc(driveLabel(sync))}</b></div>
          </div>
          ${pending.filter((p) => p.error).length ? `
            <p class="tray-lbl">Failed</p>
            <div class="list">
              ${pending.filter((p) => p.error).map((p) => `
                <div class="row"><span class="row-ico out">${icon('alert', 18)}</span>
                <span class="row-txt"><span class="row-t">${esc(p.name)}</span>
                <span class="row-s">${esc(p.error)}</span></span></div>`).join('')}
            </div>` : ''}
          <button class="btn sm" data-run ${sync.online && sync.drive === 'connected' ? '' : 'disabled'}>Upload now</button>
          ${sync.drive !== 'connected' ? `<div class="hint" style="margin-top:10px">Connect Google Drive first.</div>` : ''}`;
      }
      on(root, '[data-run]', async () => {
        toast('Uploading…');
        const r = await syncPending();
        toast(r.skipped ? 'Could not upload right now' : `${r.done} uploaded${r.failed ? `, ${r.failed} failed` : ''}`, r.failed ? 'warn' : '');
        await paint();
        back();
      });
    },
  });
}

/* ── PIN ───────────────────────────────────────────────────── */

function pinSheet(ctx, back) {
  const sheet = openSheet({
    title: 'PIN lock',
    body: `<div class="sheet-body" data-b></div>`,
    onMount(root) {
      const b = root.querySelector('[data-b]');
      paint();
      function paint() {
        b.innerHTML = `
          <div class="hint" style="margin-bottom:14px">
            A 4-digit PIN asked once when the app opens. It keeps a passer-by out of your ledger —
            it does not encrypt what is stored, so treat the phone itself as the real lock.
          </div>
          ${hasPin() ? `
            <div class="switchrow" data-skip>
              <div><div class="sw-t">Skip on this device</div><div class="sw-s">Useful on the desktop you test from</div></div>
              <div class="switch ${device.get('skipPin') ? 'on' : ''}"></div>
            </div>
            <button class="btn sm" data-change>Change PIN</button>
            <button class="btn danger sm" data-off>Turn the PIN off</button>
          ` : `<button class="btn" data-set>Set a PIN</button>`}`;
      }

      on(root, '[data-skip]', (e, el) => {
        const next = !device.get('skipPin');
        device.set('skipPin', next);
        el.querySelector('.switch').classList.toggle('on', next);
      });

      on(root, '[data-set], [data-change]', () => askNewPin(() => { paint(); back(); }));

      on(root, '[data-off]', async () => {
        const ok = await confirmSheet({
          title: 'Turn the PIN off?',
          message: 'Anyone who picks up this phone will be able to open Phynance.',
          confirmLabel: 'Turn it off', danger: true,
        });
        if (!ok) return;
        clearPin();
        toast('PIN removed');
        paint();
        back();
      });
    },
  });
}

function askNewPin(done) {
  let first = '';
  const sheet = openSheet({
    title: 'Set PIN',
    body: `
      <div class="sheet-body" style="text-align:center">
        <p class="hint" data-msg style="margin:6px 0 16px">Choose a 4-digit PIN</p>
        <input class="control num" data-pin type="password" inputmode="numeric" maxlength="4"
               style="text-align:center;font-size:26px;letter-spacing:9px" placeholder="••••">
        <button class="btn" data-ok>Continue</button>
      </div>`,
    onMount(root) {
      const input = root.querySelector('[data-pin]');
      const msg = root.querySelector('[data-msg]');
      setTimeout(() => input.focus(), 250);
      on(root, '[data-ok]', async () => {
        const v = input.value.trim();
        if (!/^\d{4}$/.test(v)) { toast('Four digits', 'warn'); return; }
        if (!first) {
          first = v;
          input.value = '';
          msg.textContent = 'Type it once more';
          input.focus();
          return;
        }
        if (v !== first) {
          first = '';
          input.value = '';
          msg.textContent = 'They did not match — start again';
          return;
        }
        await setPin(v);
        toast('PIN set');
        sheet.close();
        done();
      });
    },
  });
}

/* ── Backup ────────────────────────────────────────────────── */

function backupSheet(ctx, back) {
  const sheet = openSheet({
    title: 'Backup & restore',
    body: `
      <div class="sheet-body">
        <div class="hint" style="margin-bottom:14px">
          A backup is one JSON file holding every entry, account, category and job.
          Bill photos stay on the device — they are not inside it.
        </div>
        <button class="btn" data-export>${icon('download', 15)} Export backup</button>
        <button class="btn sec sm" data-merge>${icon('upload', 15)} Restore — add to what is here</button>
        <button class="btn sec sm" data-replace>${icon('upload', 15)} Restore — replace everything</button>
        <div class="hint" style="margin-top:14px">
          Your PIN and API key are deliberately left out of the backup, so restoring on another
          device never carries credentials across.
        </div>
      </div>`,
    onMount(root) {
      on(root, '[data-export]', () => {
        const n = exportBackup();
        toast(`Backup with ${n} entries saved`);
      });

      async function restore(merge) {
        try {
          const payload = await readBackupFile();
          if (!payload) return;
          if (!merge) {
            const ok = await confirmSheet({
              title: 'Replace everything?',
              message: 'Every entry currently on this device is discarded and replaced by the backup. Export first if you are unsure.',
              confirmLabel: 'Replace', danger: true,
            });
            if (!ok) return;
          }
          importAll(payload, { merge });
          toast('Restored');
          sheet.close();
          back();
          ctx.refresh();
        } catch (e) {
          toast(String(e.message || e), 'err', 3600);
        }
      }
      on(root, '[data-merge]', () => restore(true));
      on(root, '[data-replace]', () => restore(false));
    },
  });
}

/* ── About ─────────────────────────────────────────────────── */

function aboutSheet(ctx, back) {
  const sheet = openSheet({
    title: 'About Phynance',
    body: `<div class="sheet-body" data-b></div>`,
    async onMount(root) {
      const usage = await photos.usage();
      const b = root.querySelector('[data-b]');
      b.innerHTML = `
        <div class="list" style="padding:2px 14px;margin-bottom:14px">
          <div class="kv"><span>Version</span><b>1.0 — offline</b></div>
          <div class="kv"><span>Entries</span><b>${entries().length}</b></div>
          <div class="kv"><span>Photos</span><b>${usage.count} · ${humanBytes(usage.bytes)}</b></div>
          <div class="kv"><span>Ledger storage</span><b>${humanBytes(new Blob([localStorage.getItem('phynance.v1') || '']).size)}</b></div>
          <div class="kv"><span>Installed</span><b>${window.matchMedia('(display-mode: standalone)').matches ? 'As an app' : 'In the browser'}</b></div>
        </div>
        <div class="hint" style="margin-bottom:16px">
          Everything lives on this device. Nothing leaves it except bill photos you upload to your own
          Google Drive, and the bill images sent to Claude when auto-reading is on.
        </div>
        <button class="btn danger sm" data-wipe>Erase everything on this device</button>`;

      on(root, '[data-wipe]', async () => {
        const ok = await confirmSheet({
          title: 'Erase everything?',
          message: 'Every entry, job, account and photo on this device is deleted permanently. Export a backup first if you might want it back.',
          confirmLabel: 'Erase everything', danger: true,
        });
        if (!ok) return;
        const twice = await confirmSheet({
          title: 'Really erase?',
          message: 'This cannot be undone.',
          confirmLabel: 'Yes, erase', danger: true,
        });
        if (!twice) return;
        await photos.clear();
        wipe();
        toast('Everything erased');
        sheet.close();
        back();
        ctx.refresh();
      });
    },
  });
}
