/* views/settings.js — accounts, categories, recurring, the PIN, the online
   credentials, and backup. Opened from the gear on Home. */

import { icon } from '../icons.js';
import { settings as qSettings, updateSettings as updateQSettings, importHistory, decryptHistory, quotes as allQuotes, ownerOrg } from '../quotes.js';
import { syncQuotes, lastSyncError as qsError, online as qsOnline } from '../quotesync.js';
import { openSheet, on, esc, toast, confirmSheet, emptyState, field } from '../ui.js';
import {
  accounts, addAccount, updateAccount, deleteAccount, balance,
  categories, addCategory, updateCategory, deleteCategory,
  recurring, addRecurring, updateRecurring, deleteRecurring,
  settings, saveSettings, hasPin, setPin, clearPin, device,
  importAll, wipe, entries,
} from '../store.js';
import { inr } from '../format.js';
import { photos, humanBytes, pickImage, shrink, toBase64 } from '../photos.js';
import { exportBackup, readBackupFile } from '../export.js';
import { status, connectDrive, disconnectDrive, driveConfigured, syncPending, sharedDrive } from '../sync.js';
import { cloudConfigured } from '../config.js';
import { PROVIDERS, providerOf, defaultModel, isCustomModel } from '../models.js';
import { biometricAvailable, biometricEnabled, enrollBiometric, disableBiometric } from '../biometric.js';
import {
  signedIn, currentUser, currentOrgId, myOrgs, myRole, canWrite, signOut,
  members, invite, pendingInvites, revokeInvite, setRole, removeMember,
} from '../auth.js';
import { sync, pendingCount, lastSyncError } from '../cloud.js';

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
        const who = await whoAmI();
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
            ${navRow('sparkle', 'Read bills automatically', aiLabel(s), 'ai')}
            ${navRow(sync.online ? 'cloud' : 'cloudOff', 'Pending uploads',
              sync.pending ? `${sync.pending} waiting · ${humanBytes(usage.bytes)} stored` : 'Nothing waiting', 'pending')}
          </div>

          ${cloudConfigured() && signedIn() ? `
            <p class="tray-lbl sp">These books</p>
            <div class="list">
              ${navRow('user', 'People', peopleLabel(who), 'people')}
              ${navRow(sync.online ? 'cloud' : 'cloudOff', 'Sync',
                pendingCount() ? `${pendingCount()} change${pendingCount() > 1 ? 's' : ''} waiting`
                  : lastSyncError() ? 'Last sync failed' : 'Up to date', 'sync')}
              ${navRow('lock', 'Signed in', esc(who.email), 'account')}
            </div>` : ''}

          <p class="tray-lbl sp">This device</p>
          <div class="list">
            ${navRow('lock', 'PIN lock', hasPin() ? (device.get('skipPin') ? 'On, skipped on this device' : 'On') : 'Off', 'pin')}
            ${navRow('download', 'Backup & restore', `${entries().length} entries`, 'backup')}
            ${navRow('alert', 'About Kontour', 'Version, storage, reset', 'about')}
          </div>

          <p class="tray-lbl sp">Brand</p>
          <div class="list">
            ${navRow('sparkle', 'Logo', qSettings().logo ? 'Set — shows on quotations and in the app' : 'Not set', 'logo')}
            ${cloudConfigured() && signedIn() ? navRow(
              qsOnline() ? 'cloud' : 'cloudOff', 'Quotation sync',
              qsError() ? 'Last sync failed' : `${allQuotes().length} on the shared books`, 'qsync') : ''}
            ${navRow('upload', 'Quotation history',
              allQuotes().length ? `${allQuotes().length} quotation${allQuotes().length === 1 ? '' : 's'} on file`
                                 : 'Bring in the quotations from the sheet', 'history')}
          </div>

          <p class="tray-lbl sp">Quotations</p>
          <div class="list">
            ${navRow('note', 'Company & banking', `${esc(qSettings().company.name)} · shown on every quotation`, 'qcompany')}
            ${navRow('note', 'Payment terms', 'The bullets under each quote’s items', 'qpayment')}
            ${navRow('note', 'Terms & Conditions', `${(qSettings().terms || '').split('\n').filter(Boolean).length} bullets`, 'qterms')}
            ${navRow('note', 'Note Please', `${(qSettings().note || '').split(/\n{2,}/).filter(Boolean).length} paragraphs`, 'qnote')}
            ${navRow('gear', 'Quote defaults', `${qSettings().gstRate}% GST · ${qSettings().leadTimeDays || 15}-day lead time`, 'qdefaults')}
          </div>

        `;
      }

      on(root, '[data-nav]', async (e, b) => {
        const where = b.dataset.nav;
        const map = {
          accounts: accountsSheet, categories: categoriesSheet, recurring: recurringSheet,
          gst: gstSheet, drive: driveSheet, ai: aiSheet, pending: pendingSheet,
          pin: pinSheet, backup: backupSheet, about: aboutSheet, logo: logoSheet, history: historySheet, qsync: qsyncSheet,
          people: peopleSheet, sync: syncSheet, account: accountSheet,
          qcompany: qCompanySheet, qpayment: qPaymentSheet,
          qterms: qTermsSheet, qnote: qNoteSheet, qdefaults: qDefaultsSheet,
        };
        await map[where](ctx, paint);
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

/* On shared books the key is the server's, so being set up is a matter
   of the switch rather than of anything typed on this device. */
function aiLabel(s) {
  if (!s.ai.enabled) return 'Off';
  const ready = sharedDrive() || s.ai.key || s.ai.endpoint;
  if (!ready) return 'Needs an API key';
  const p = PROVIDERS[providerOf(s.ai.provider)];
  return `${p.label} · ${s.ai.model}`;
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
            An account is also the payment mode — Bank and UPI are how your sheets already record it.
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
  const icons = ['bank', 'phone', 'wallet', 'user', 'box'];
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
          <b>${esc(s.drive.folderName || 'Kontour')}/2026/08/</b>. Kontour only ever sees the files it
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
          <input class="control" data-folder value="${esc(s.drive.folderName || 'Kontour')}">
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
            folderName: root.querySelector('[data-folder]').value.trim() || 'Kontour',
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
  // Held outside the markup so switching provider can repaint the model
  // list without losing what has been typed into the other fields.
  let provider = providerOf(s.ai.provider);
  let model = s.ai.model || defaultModel(provider);
  let enabled = s.ai.enabled;
  /* Tracked separately rather than inferred from the model string:
     choosing "Other…" clears the field, and an empty string is not a
     custom model id — it is someone who has not typed one yet. */
  let custom = isCustomModel(provider, model);

  const sheet = openSheet({
    title: 'Read bills automatically',
    body: `<div class="sheet-body" data-body></div>`,
    onMount(root) {
      const body = root.querySelector('[data-body]');
      paint();

      function paint() {
        const p = PROVIDERS[provider];
        // On shared books the key lives on the server, so the field below
        // would be asking for something nobody needs to supply.
        const onServer = sharedDrive();

        body.innerHTML = `
          <div class="hint" style="margin-bottom:14px">
            When a bill photo is added and you are online, the model reads it and fills in
            the amount, date, party, GST and a one-line description. Nothing is saved until
            you check it and tap save.
          </div>

          <div class="switchrow" data-en>
            <div>
              <div class="sw-t">Read bills automatically</div>
              <div class="sw-s">Only when online</div>
            </div>
            <div class="switch ${enabled ? 'on' : ''}"></div>
          </div>

          <p class="tray-lbl sp">Which model reads them</p>
          <div class="toggle2" style="margin-bottom:12px">
            ${Object.entries(PROVIDERS).map(([id, cfg]) => `
              <button data-provider="${id}" class="${provider === id ? 'on' : ''}">${esc(cfg.label)}</button>`).join('')}
          </div>

          <div class="catgrid" style="margin-bottom:6px">
            ${p.models.map((m) => `
              <button class="cat ${model === m.id ? 'on' : ''}" data-model="${esc(m.id)}"
                      title="${esc(m.note)}">${esc(m.label)}</button>`).join('')}
            <button class="cat ${custom ? 'on' : ''}" data-model="__custom">Other…</button>
          </div>
          <div class="hint">${esc((p.models.find((m) => m.id === model) || {}).note || 'Any model id this provider accepts.')}</div>

          ${custom ? `
            <div class="field" style="margin-top:12px">
              <label>Model id</label>
              <input class="control" data-custom value="${esc(model)}" placeholder="${esc(defaultModel(provider))}">
              <div class="hint">Sent through as typed, so a model released since this app was built still works.</div>
            </div>` : ''}

          ${onServer ? `
            <div class="hint" style="margin-top:16px">
              The ${esc(p.label)} key is held by your server, not this phone — nothing to enter here.
              It is set as <b>${esc(p.keyEnv)}</b> in the Vercel environment.
            </div>`
          : `
            <div class="field sp" style="margin-top:16px">
              <label>${esc(p.label)} API key</label>
              <input class="control" data-key type="password" value="${esc(s.ai.key)}"
                     placeholder="${provider === 'gemini' ? 'AIza…' : 'sk-ant-…'}">
              <div class="hint warn">
                Stored in this browser and sent straight from the phone. Fine on your own device;
                once you sign in to shared books the key moves to the server instead.
              </div>
            </div>
            <div class="field">
              <label>Server endpoint (optional)</label>
              <input class="control" data-ep value="${esc(s.ai.endpoint || '')}"
                     placeholder="https://kontour.…/api/read-bill">
              <div class="hint">Set this and the key above is ignored — the request goes to your server.</div>
            </div>`}

          <button class="btn" data-save>Save</button>`;
      }

      on(root, '[data-en]', (e, el) => {
        enabled = !enabled;
        el.querySelector('.switch').classList.toggle('on', enabled);
      });

      on(root, '[data-provider]', (e, b) => {
        if (b.dataset.provider === provider) return;
        provider = b.dataset.provider;
        // The old model id means nothing to the new provider.
        model = defaultModel(provider);
        custom = false;
        paint();
      });

      on(root, '[data-model]', (e, b) => {
        const pick = b.dataset.model;
        custom = pick === '__custom';
        if (!custom) model = pick;
        paint();
        if (custom) root.querySelector('[data-custom]').focus();
      });

      on(root, '[data-save]', () => {
        const customField = root.querySelector('[data-custom]');
        const chosen = customField ? customField.value.trim() : model;
        if (!chosen) return toast('Pick a model, or type one in', 'warn');

        const keyField = root.querySelector('[data-key]');
        const epField = root.querySelector('[data-ep]');

        saveSettings({
          ai: {
            ...settings().ai,
            enabled,
            provider,
            model: chosen,
            // Absent on shared books, where the server holds the key —
            // keep whatever was there rather than blanking it.
            ...(keyField ? { key: keyField.value.trim() } : {}),
            ...(epField ? { endpoint: epField.value.trim() } : {}),
          },
        });
        toast('Saved');
        sheet.close();
        back();
      });
    },
  });
}

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
    async onMount(root) {
      const b = root.querySelector('[data-b]');
      // Checked once: it involves an async platform call, and nothing
      // about the answer changes while this sheet is open.
      const bioCapable = await biometricAvailable();
      paint();

      function paint() {
        b.innerHTML = `
          <div class="hint" style="margin-bottom:14px">
            A 4-digit PIN asked when the app opens. It keeps a passer-by out of your ledger —
            it does not encrypt what is stored, so treat the phone itself as the real lock.
          </div>
          ${hasPin() ? `
            ${bioCapable ? `
              <div class="switchrow" data-bio>
                <div>
                  <div class="sw-t">Face ID / fingerprint</div>
                  <div class="sw-s">Whatever unlocks this device — the PIN still works if it fails</div>
                </div>
                <div class="switch ${biometricEnabled() ? 'on' : ''}"></div>
              </div>` : ''}
            <div class="switchrow" data-skip>
              <div><div class="sw-t">Skip on this device</div><div class="sw-s">Useful on the desktop you test from</div></div>
              <div class="switch ${device.get('skipPin') ? 'on' : ''}"></div>
            </div>
            <button class="btn sm" data-change>Change PIN</button>
            <button class="btn danger sm" data-off>Turn the PIN off</button>
          ` : `<button class="btn" data-set>Set a PIN</button>
          ${bioCapable ? `<div class="hint" style="margin-top:10px">Set a PIN first — it stays the fallback for whenever Face ID or a fingerprint does not work.</div>` : ''}`}`;
      }

      on(root, '[data-skip]', (e, el) => {
        const next = !device.get('skipPin');
        device.set('skipPin', next);
        el.querySelector('.switch').classList.toggle('on', next);
      });

      on(root, '[data-bio]', async (e, el) => {
        if (biometricEnabled()) {
          disableBiometric();
          toast('Face ID / fingerprint turned off');
          paint();
          return;
        }
        try {
          await enrollBiometric();
          toast('Face ID / fingerprint enabled');
        } catch (err) {
          toast(err.message || 'Could not set that up', 'err');
        }
        paint();
      });

      on(root, '[data-set], [data-change]', () => askNewPin(() => { paint(); back(); }));

      on(root, '[data-off]', async () => {
        const ok = await confirmSheet({
          title: 'Turn the PIN off?',
          message: biometricEnabled()
            ? 'Face ID / fingerprint will also turn off — anyone who picks up this phone will be able to open Kontour.'
            : 'Anyone who picks up this phone will be able to open Kontour.',
          confirmLabel: 'Turn it off', danger: true,
        });
        if (!ok) return;
        clearPin();
        disableBiometric();
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
    title: 'About Kontour',
    body: `<div class="sheet-body" data-b></div>`,
    async onMount(root) {
      const usage = await photos.usage();
      const b = root.querySelector('[data-b]');
      b.innerHTML = `
        <div class="list" style="padding:2px 14px;margin-bottom:14px">
          <div class="kv"><span>Version</span><b>1.0 — offline</b></div>
          <div class="kv"><span>Entries</span><b>${entries().length}</b></div>
          <div class="kv"><span>Photos</span><b>${usage.count} · ${humanBytes(usage.bytes)}</b></div>
          <div class="kv"><span>Ledger storage</span><b>${humanBytes(new Blob([localStorage.getItem('kontour.v1') || '']).size)}</b></div>
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

/* ── Shared books ─────────────────────────────────────────────
   Only reachable when this copy is signed in, so every sheet below
   can assume there is a session and an org. */

const ROLE_NOTE = {
  owner: 'Everything, including managing people',
  admin: 'Everything except removing the owner',
  staff: 'Log, edit and delete entries',
  viewer: 'Read only — every save is refused',
};

async function whoAmI() {
  const user = currentUser();
  let role = '';
  let orgName = '';
  try {
    role = await myRole();
    const all = await myOrgs();
    const here = all.find((o) => o.id === currentOrgId());
    if (here) orgName = here.name;
  } catch {
    // Offline, or the session has lapsed. The screen still draws; it
    // just cannot say what this account may do until the next sync.
  }
  return { email: user ? user.email : '', role, orgName };
}

function peopleLabel(who) {
  if (!who.role) return who.orgName || 'Shared books';
  return `${who.orgName || 'Shared books'} · you are ${who.role}`;
}

function peopleSheet(ctx, back) {
  return openSheet({
    title: 'People',
    full: true,
    body: `<div class="sheet-body" data-body><div class="empty"><p>Loading…</p></div></div>`,
    async onMount(root) {
      const body = root.querySelector('[data-body]');
      await paint();

      async function paint() {
        let list = [];
        let waiting = [];
        let role = '';
        try {
          role = await myRole();
          list = await members() || [];
          waiting = await pendingInvites() || [];
        } catch (e) {
          body.innerHTML = `
            <div class="hint warn">Could not load the people on these books — ${esc(e.message)}</div>`;
          return;
        }

        const admin = ['owner', 'admin'].includes(role);
        const me = currentUser();

        body.innerHTML = `
          <p class="tray-lbl">On these books</p>
          <div class="list">
            ${list.map((m) => {
              const p = m.profiles || {};
              const isMe = me && m.user_id === me.id;
              return `
                <button class="row" ${admin && !isMe ? `data-person="${esc(m.user_id)}"` : ''}>
                  <span class="row-ico">${icon('user', 18)}</span>
                  <span class="row-txt">
                    <span class="row-t">${esc(p.full_name || p.email || 'Member')}${isMe ? ' (you)' : ''}</span>
                    <span class="row-s">${esc(p.email || '')}</span>
                  </span>
                  <span class="pill ${m.role === 'viewer' ? 'mut' : 'in'}">${esc(m.role)}</span>
                </button>`;
            }).join('')}
          </div>

          ${waiting.length ? `
            <p class="tray-lbl sp">Invited, not signed up yet</p>
            <div class="list">
              ${waiting.map((i) => `
                <div class="row">
                  <span class="row-ico">${icon('mail', 18)}</span>
                  <span class="row-txt">
                    <span class="row-t">${esc(i.email)}</span>
                    <span class="row-s">Joins as ${esc(i.role)} when they sign up</span>
                  </span>
                  ${admin ? `<button class="pill warn" data-revoke="${esc(i.id)}">Cancel</button>` : ''}
                </div>`).join('')}
            </div>` : ''}

          ${admin ? `
            <p class="tray-lbl sp">Invite someone</p>
            <div class="field">
              <input class="control" data-email type="email" inputmode="email"
                     placeholder="them@banavat-india.com" autocomplete="off">
            </div>
            <div class="field">
              <label>They can</label>
              <select class="control" data-role>
                <option value="staff">Log and edit entries</option>
                <option value="admin">Everything, including people</option>
                <option value="viewer">Only read the books</option>
              </select>
            </div>
            <button class="btn sm" data-invite>Send invite</button>
            <div class="hint">
              An invite works whether or not they already have an account. If
              they do, they get access straight away; if not, the moment they
              sign up with that email.
            </div>`
          : `<div class="hint sp">Only an owner or admin can invite people or change what someone can do.</div>`}
        `;
      }

      on(root, '[data-invite]', async () => {
        const email = root.querySelector('[data-email]').value.trim();
        const r = root.querySelector('[data-role]').value;
        if (!email || !email.includes('@')) return toast('Enter their email address', 'warn');
        try {
          await invite(email, r);
          toast(`${email} invited`);
          await paint();
        } catch (e) {
          // A second invite to the same address hits the unique index
          // rather than creating a duplicate.
          toast(/duplicate|unique/i.test(e.message) ? 'They have already been invited' : e.message, 'err');
        }
      });

      on(root, '[data-revoke]', async (e, b) => {
        try {
          await revokeInvite(b.dataset.revoke);
          toast('Invite cancelled');
          await paint();
        } catch (err) { toast(err.message, 'err'); }
      });

      on(root, '[data-person]', async (e, b) => {
        const id = b.dataset.person;
        const m = (await members()).find((x) => x.user_id === id);
        if (!m) return;
        await personSheet(m, paint);
      });
    },
    onClose: back,
  });
}

function personSheet(m, back) {
  const p = m.profiles || {};
  return openSheet({
    title: p.full_name || p.email || 'Member',
    body: `
      <div class="sheet-body">
        <p class="tray-lbl">What they can do</p>
        <div class="list">
          ${['admin', 'staff', 'viewer'].map((r) => `
            <button class="row" data-set="${r}">
              <span class="row-ico">${icon(r === 'viewer' ? 'ledger' : 'user', 18)}</span>
              <span class="row-txt">
                <span class="row-t">${r[0].toUpperCase()}${r.slice(1)}</span>
                <span class="row-s">${esc(ROLE_NOTE[r])}</span>
              </span>
              ${m.role === r ? `<span class="pill in">now</span>` : ''}
            </button>`).join('')}
        </div>
        ${m.role === 'owner'
          ? `<div class="hint sp">The owner's access cannot be changed here.</div>`
          : `<button class="btn danger sm" data-remove>Remove from these books</button>
             <div class="hint">Their entries stay in the books. They lose access on their next sync.</div>`}
      </div>`,
    onMount(root, handle) {
      on(root, '[data-set]', async (e, b) => {
        try {
          await setRole(m.user_id, b.dataset.set);
          toast('Updated');
          handle.close();
          await back();
        } catch (err) { toast(err.message, 'err'); }
      });
      on(root, '[data-remove]', async () => {
        const ok = await confirmSheet({
          title: 'Remove them?',
          message: `${p.email || 'This person'} will lose access to these books. Everything they logged stays.`,
          confirmLabel: 'Remove',
          danger: true,
        });
        if (!ok) return;
        try {
          await removeMember(m.user_id);
          toast('Removed');
          handle.close();
          await back();
        } catch (err) { toast(err.message, 'err'); }
      });
    },
  });
}

function syncSheet(ctx, back) {
  return openSheet({
    title: 'Sync',
    body: `<div class="sheet-body" data-body></div>`,
    async onMount(root, handle) {
      const body = root.querySelector('[data-body]');
      paint();

      function paint() {
        const waiting = pendingCount();
        const err = lastSyncError();
        body.innerHTML = `
          <div class="list" style="padding:2px 14px">
            <div class="kv"><span>Waiting to upload</span><b>${waiting || 'nothing'}</b></div>
            <div class="kv"><span>Connection</span><b>${navigator.onLine === false ? 'Offline' : 'Online'}</b></div>
            ${err ? `<div class="kv"><span>Last attempt</span><b style="color:var(--out)">Failed</b></div>` : ''}
          </div>
          ${err ? `<div class="hint warn">${esc(err)}</div>` : ''}
          <button class="btn sm" data-now>Sync now</button>
          <div class="hint">
            Entries save on this device first and go up on their own — when
            the connection returns, when you come back to the app, and every
            few minutes. Nothing here has to be done by hand.
          </div>`;
      }

      on(root, '[data-now]', async () => {
        const b = root.querySelector('[data-now]');
        b.disabled = true;
        b.textContent = 'Syncing…';
        const r = await sync({ settingsToo: true });
        b.disabled = false;
        b.textContent = 'Sync now';
        if (r.error) toast(r.error, 'err');
        else if (r.skipped) toast(`Not synced — ${r.skipped}`, 'warn');
        else toast(`${r.pushed || 0} up, ${r.pulled || 0} down`);
        paint();
        ctx.refresh();
      });
    },
    onClose: back,
  });
}

function accountSheet(ctx, back) {
  const user = currentUser();
  return openSheet({
    title: 'Your account',
    body: `
      <div class="sheet-body">
        <div class="list" style="padding:2px 14px">
          <div class="kv"><span>Signed in as</span><b>${esc(user ? user.email : '')}</b></div>
        </div>
        <button class="btn danger sm" data-out>Sign out</button>
        <div class="hint">
          Signing out clears these books from this device. Nothing is deleted
          — signing back in fetches them again. Anything not yet uploaded
          goes up first.
        </div>
      </div>`,
    onMount(root, handle) {
      on(root, '[data-out]', async () => {
        const waiting = pendingCount();
        const ok = await confirmSheet({
          title: 'Sign out?',
          message: waiting
            ? `${waiting} change${waiting > 1 ? 's have' : ' has'} not been uploaded yet. Kontour will try to send ${waiting > 1 ? 'them' : 'it'} first.`
            : 'These books will be cleared from this device. Signing back in fetches them again.',
          confirmLabel: 'Sign out',
          danger: true,
        });
        if (!ok) return;

        // One last push, so work done on a bad connection is not stranded
        // on a device that is about to forget it.
        if (waiting) {
          const r = await sync();
          if (r.error || pendingCount()) {
            const anyway = await confirmSheet({
              title: 'Still not uploaded',
              message: 'Those changes could not be sent. Signing out now loses them. Staying signed in keeps them until the connection is better.',
              confirmLabel: 'Sign out and lose them',
              danger: true,
            });
            if (!anyway) return;
          }
        }

        const { wipe } = await import('../store.js');
        await signOut();
        wipe();
        location.reload();
      });
    },
    onClose: back,
  });
}


/* ── Quotation settings ──────────────────────────────────────────
   The boilerplate every quotation prints, editable instead of baked
   into the code — see js/quotes.js's SHARED_QUOTE_SETTINGS for the
   full list of what a change here carries to every device on the
   same books. */

function qCompanySheet(ctx, back) {
  const s = qSettings();
  const c = s.company, b = s.bank;
  const h = openSheet({
    title: 'Company & banking',
    body: `
      <div class="sheet-body">
        <p class="tray-lbl">Shown in every quotation's letterhead and contact block</p>
        <div class="field"><label>Company name</label><input class="control" data-name value="${esc(c.name)}"></div>
        <div class="field"><label>GSTIN</label><input class="control" data-gstin value="${esc(c.gstin)}"></div>
        <div class="field"><label>Address</label><input class="control" data-address value="${esc(c.address)}"></div>
        <div class="field-2">
          <div class="field"><label>Email</label><input class="control" data-email value="${esc(c.email)}"></div>
          <div class="field"><label>Phone</label><input class="control" data-phone value="${esc(c.phone)}"></div>
        </div>
        <div class="field"><label>Website</label><input class="control" data-website value="${esc(c.website)}"></div>

        <p class="tray-lbl sp">Banking details</p>
        <div class="field"><label>Bank</label><input class="control" data-bank value="${esc(b.bank)}"></div>
        <div class="field-2">
          <div class="field"><label>A/C name</label><input class="control" data-bname value="${esc(b.name)}"></div>
          <div class="field"><label>A/C number</label><input class="control" data-bacc value="${esc(b.account)}"></div>
        </div>
        <div class="field-2">
          <div class="field"><label>IFSC</label><input class="control" data-bifsc value="${esc(b.ifsc)}"></div>
          <div class="field"><label>Branch</label><input class="control" data-bbranch value="${esc(b.branch)}"></div>
        </div>
        <button class="btn" data-save>Save</button>
      </div>`,
    onMount(root) {
      on(root, '[data-save]', () => {
        updateQSettings({
          company: {
            name: root.querySelector('[data-name]').value,
            gstin: root.querySelector('[data-gstin]').value,
            address: root.querySelector('[data-address]').value,
            email: root.querySelector('[data-email]').value,
            phone: root.querySelector('[data-phone]').value,
            website: root.querySelector('[data-website]').value,
          },
          bank: {
            bank: root.querySelector('[data-bank]').value,
            name: root.querySelector('[data-bname]').value,
            account: root.querySelector('[data-bacc]').value,
            ifsc: root.querySelector('[data-bifsc]').value,
            branch: root.querySelector('[data-bbranch]').value,
          },
        });
        toast('Saved');
        h.close();
        back();
      });
    },
  });
  return h;
}

function qPaymentSheet(ctx, back) {
  const s = qSettings();
  const h = openSheet({
    title: 'Payment terms',
    body: `
      <div class="sheet-body">
        <div class="field">
          <label>One line per bullet</label>
          <textarea class="control" data-terms rows="6">${esc(s.paymentTerms || '')}</textarea>
          <div class="hint">Printed under Payment Terms on every quotation — only the default a new one starts from; each quotation can still edit its own.</div>
        </div>
        <button class="btn" data-save>Save</button>
      </div>`,
    onMount(root) {
      on(root, '[data-save]', () => {
        updateQSettings({ paymentTerms: root.querySelector('[data-terms]').value });
        toast('Saved');
        h.close();
        back();
      });
    },
  });
  return h;
}

function qTermsSheet(ctx, back) {
  const s = qSettings();
  const h = openSheet({
    title: 'Terms & Conditions',
    body: `
      <div class="sheet-body">
        <div class="field">
          <label>One line per bullet</label>
          <textarea class="control" data-terms rows="10">${esc(s.terms || '')}</textarea>
          <div class="hint">{{leadTime}} and {{fabricRate}} are filled in from each quotation's own figures when it prints.</div>
        </div>
        <button class="btn" data-save>Save</button>
      </div>`,
    onMount(root) {
      on(root, '[data-save]', () => {
        updateQSettings({ terms: root.querySelector('[data-terms]').value });
        toast('Saved');
        h.close();
        back();
      });
    },
  });
  return h;
}

function qNoteSheet(ctx, back) {
  const s = qSettings();
  const h = openSheet({
    title: 'Note Please',
    body: `
      <div class="sheet-body">
        <div class="field">
          <label>Paragraphs, one blank line between each</label>
          <textarea class="control" data-note rows="10">${esc(s.note || '')}</textarea>
          <div class="hint">Printed under "Note Please", right after Terms & Conditions.</div>
        </div>
        <button class="btn" data-save>Save</button>
      </div>`,
    onMount(root) {
      on(root, '[data-save]', () => {
        updateQSettings({ note: root.querySelector('[data-note]').value });
        toast('Saved');
        h.close();
        back();
      });
    },
  });
  return h;
}

function qDefaultsSheet(ctx, back) {
  const s = qSettings();
  const h = openSheet({
    title: 'Quote defaults',
    body: `
      <div class="sheet-body">
        <div class="field">
          <label>Default GST rate %</label>
          <input class="control num" data-gstrate type="number" min="0" max="28" value="${s.gstRate}">
        </div>
        <div class="field">
          <label>Default lead time (days)</label>
          <input class="control num" data-leaddays type="number" min="0" inputmode="numeric" value="${s.leadTimeDays || 15}">
        </div>
        <div class="field">
          <label>Default delivery city</label>
          <input class="control" data-city value="${esc(s.defaultCity || '')}">
        </div>
        <button class="btn" data-save>Save</button>
      </div>`,
    onMount(root) {
      on(root, '[data-save]', () => {
        const days = Number(root.querySelector('[data-leaddays]').value) || 15;
        updateQSettings({
          gstRate: Number(root.querySelector('[data-gstrate]').value) || 0,
          leadTimeDays: days,
          leadTime: `${days}–${days + 5} business days`,
          defaultCity: root.querySelector('[data-city]').value,
        });
        toast('Saved');
        h.close();
        back();
      });
    },
  });
  return h;
}

/* ── Brand ─────────────────────────────────────────────────────
   One image, used by the quotation document, the rail wordmark and
   the lock screen. Stored with the quotation settings rather than
   shipped as a repo asset, so replacing it is an upload rather than
   a deploy — and so it travels in a backup. */
async function logoSheet(ctx, back) {
  const h = openSheet({
    title: 'Logo',
    body: `<div class="sheet-body" data-logo></div>`,
    onMount(root) {
      const host = root.querySelector('[data-logo]');
      paint();

      function paint() {
        const src = qSettings().logo || '';
        host.innerHTML = `
          <p class="sheet-lede">
            Shown at the head of every quotation, on the sign-in and lock
            screens, and beside the app name in the sidebar.
          </p>
          <button class="dphoto logo-drop ${src ? 'has' : ''}" data-pick>
            ${src ? `<img src="${esc(src)}" alt="Current logo">`
                  : `<span>${icon('camera', 26)}<small>Choose the logo file</small></span>`}
          </button>
          <p class="qb-hint">
            A square PNG or JPEG works best. It is stored on this device
            and included in a backup.
          </p>
          <button class="btn" data-pick>${src ? 'Replace logo' : 'Choose logo'}</button>
          ${src ? `<button class="btn sec sm" data-clear>Remove logo</button>` : ''}
        `;
        on(host, '[data-pick]', async () => {
          const files = await pickImage({ camera: false });
          if (!files || !files[0]) return;
          const { blob } = await shrink(files[0]);
          updateQSettings({ logo: `data:image/jpeg;base64,${await toBase64(blob)}` });
          toast('Logo saved');
          paint();
          if (back) back();
        });
        on(host, '[data-clear]', () => {
          updateQSettings({ logo: '' });
          toast('Logo removed');
          paint();
          if (back) back();
        });
      }
    },
  });
  return h;
}


/* ── Quotation history ─────────────────────────────────────────
   The backfill of what lived in the spreadsheet. Two ways in, both
   ending in the same place.

   The bundled copy is encrypted, because the records carry client
   names, phone numbers and prices and the app is served publicly —
   ciphertext can sit next to the app, the passphrase cannot. It is
   decrypted in the browser, so the readable data never crosses the
   network and never exists on any server but your own.

   Safe to run more than once either way: matching is on number,
   client, date and figures together, so nothing already here is
   duplicated and nothing edited here is overwritten. */
async function historySheet(ctx, back) {
  openSheet({
    title: 'Quotation history',
    body: `<div class="sheet-body" data-hist></div>
           <input type="file" accept="application/json,.json" data-file hidden>`,
    onMount(root) {
      const host = root.querySelector('[data-hist]');
      const input = root.querySelector('[data-file]');

      /* Bound once. paint() only rewrites the panel above them, so
         nothing here is ever wired twice — two live handlers would
         mean two imports racing on the same click. */
      on(root, '[data-decrypt]', async (e, b) => {
        const pass = root.querySelector('[data-pass]').value.trim();
        if (!pass) { toast('Enter the passphrase', 'err'); return; }
        b.disabled = true;
        /* Without crypto.subtle this runs in plain JavaScript on this
           thread and takes a few seconds, so say so and let the browser
           draw the message before the grind starts. */
        const slow = !(globalThis.crypto && crypto.subtle && crypto.subtle.importKey);
        b.textContent = slow ? 'Unlocking… this takes a few seconds' : 'Unlocking…';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        try {
          done(await importHistory(await decryptHistory(pass)));
        } catch (err) {
          console.error('[kontour] import failed', err);
          paint({ error: err.message || 'That file could not be opened' });
        }
        b.disabled = false;
        b.textContent = 'Unlock and import';
      });

      on(root, '[data-pick]', () => input.click());
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          done(await importHistory(JSON.parse(await file.text())));
        } catch (err) {
          console.error('[kontour] import failed', err);
          paint({ error: err.message || 'That file could not be read' });
        }
        input.value = '';
      };

      paint();

      function done(r) {
        toast(r.added ? `${r.added} quotations imported` : 'Nothing new to import');
        paint(r);
      }

      function paint(result) {
        const n = allQuotes().length;
        host.innerHTML = `
          <p class="sheet-lede">
            Brings in the quotations recorded in the Banavat spreadsheet —
            the older BOQ-headed documents and the current ones alike — as
            records you can open, revise and reprint.
          </p>

          ${result ? `<div class="snip-none" style="border-style:solid">
              ${icon(result.error ? 'alert' : 'check', 20)}
              <span>${esc(result.error
                || `${result.added} added${result.skipped ? `, ${result.skipped} already here` : ''}`)}</span>
            </div>` : ''}

          <p class="tray-lbl">From the bundled history</p>
          ${field('Passphrase',
            `<input class="control" type="password" data-pass autocomplete="off"
                    placeholder="four words and a number">`,
            'Sent to you separately. The file ships encrypted and is opened on this device.')}
          <button class="btn" data-decrypt>Unlock and import</button>

          <p class="tray-lbl sp">Or from a file</p>
          <button class="btn sec sm" data-pick>Choose a JSON file</button>

          <p class="qb-hint">
            ${n ? `${n} quotation${n === 1 ? '' : 's'} on file.` : 'Nothing imported yet.'}
            Running this again only fills gaps.
          </p>
        `;
      }
    },
  });
}


/* ── Quotation sync ────────────────────────────────────────────
   What is on the shared books, and a way to make it so now rather
   than at the next five-minute tick. */
async function qsyncSheet(ctx, back) {
  openSheet({
    title: 'Quotation sync',
    body: `<div class="sheet-body" data-qs></div>`,
    onMount(root) {
      const host = root.querySelector('[data-qs]');
      paint();

      function paint(result) {
        const n = allQuotes().length;
        host.innerHTML = `
          <p class="sheet-lede">
            Quotations live on the same books as the ledger, behind the
            same sign-in. Anyone you have added to these books sees them;
            nobody else can, signed in or not.
          </p>
          ${result && result.error ? `<div class="snip-none" style="border-style:solid">
              ${icon('alert', 20)}<span>${esc(result.error)}</span></div>` : ''}
          ${result && !result.error ? `<div class="snip-none" style="border-style:solid">
              ${icon('check', 20)}<span>${result.pushed || 0} sent · ${result.pulled || 0} received</span></div>` : ''}
          <div class="list">
            ${plainRow('On this device', `${n} quotation${n === 1 ? '' : 's'}`)}
            ${plainRow('Connection', qsOnline() ? 'Online' : 'Offline')}
            ${plainRow('Last result', qsError() || 'No errors')}
          </div>
          <button class="btn" data-run>Sync now</button>
        `;
        on(host, '[data-run]', async (e, b) => {
          b.disabled = true;
          b.textContent = 'Syncing…';
          const r = await syncQuotes({ settingsToo: true });
          paint(r);
          if (back) back();
        });
      }
    },
  });
}

function plainRow(label, value) {
  return `<div class="row"><div class="row-main"><div class="row-t">${esc(label)}</div>
    <div class="row-s">${esc(value)}</div></div></div>`;
}
