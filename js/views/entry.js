/* views/entry.js — logging money.
   The whole app is judged here, so the default path is: amount → in/out →
   category → Save. Everything else hides behind "More details". */

import { icon } from '../icons.js';
import { openSheet, on, esc, toast, haptic, confirmSheet } from '../ui.js';
import {
  accounts, categories, addEntry, updateEntry, deleteEntry, getEntry,
  computeAmounts, settings, recentJobCodes, recentParties, balance,
  ensureJob, getJob, raw,
} from '../store.js';
import { num, inr, todayISO, dmy, dayLabel } from '../format.js';
import { pickImage, attach, detach, bindToEntry, photos, humanBytes } from '../photos.js';
import { blobURL } from '../db.js';
import { aiConfigured, online, readBill, canUpload, sharedDrive, syncPending } from '../sync.js';
import { burst } from '../motion.js';

const RATES = [0, 5, 12, 18, 28];

/**
 * openEntrySheet({ entry, prefill, onSaved })
 * `entry` edits an existing one, `prefill` seeds a new one (used by
 * recurring templates and by "repeat this entry").
 */
export function openEntrySheet({ entry = null, prefill = null, onSaved } = {}) {
  const editing = !!entry;
  const s = settings();

  const f = {
    type: (entry && entry.type) || (prefill && prefill.type) || 'out',
    amount: entry ? String(entry.entered) : (prefill && prefill.entered ? String(prefill.entered) : ''),
    accountId: (entry && entry.accountId) || (prefill && prefill.accountId) || raw().meta.lastAccountId || 'bank',
    toAccountId: (entry && entry.toAccountId) || (prefill && prefill.toAccountId) || '',
    categoryId: (entry && entry.categoryId) || (prefill && prefill.categoryId) || '',
    date: (entry && entry.date) || (prefill && prefill.date) || todayISO(),
    jobCode: (entry && entry.jobCode) || (prefill && prefill.jobCode) || '',
    party: (entry && entry.party) || (prefill && prefill.party) || '',
    note: (entry && entry.note) || (prefill && prefill.note) || '',
    gst: entry ? { ...entry.gst } : { on: false, rate: s.gstDefaultRate, mode: s.gstDefaultMode },
    photoIds: entry ? (entry.photoIds || []).slice() : [],
  };

  if (!f.categoryId && f.type !== 'transfer') f.categoryId = defaultCategory(f.type);
  f.__canDelete = editing;

  let photoRecs = [];
  let reading = false;

  const sheet = openSheet({
    title: editing ? 'Edit entry' : 'New entry',
    dark: true,
    full: true,
    headRight: `<button class="icon-btn" data-photo aria-label="Attach bill">${icon('camera', 21)}</button>`,
    body: bodyHTML(f),
    onMount(root, handle) {
      const $ = (sel) => root.querySelector(sel);

      /* ── painting ─────────────────────────────────────────── */
      function paintAmount() {
        const box = $('[data-amount]');
        const val = f.amount === '' ? '0' : f.amount;
        box.classList.toggle('zero', f.amount === '');
        box.innerHTML = `<span class="cur">₹</span>${esc(prettyAmount(val))}`;

        const note = $('[data-note]');
        const n = Number(f.amount || 0);
        if (f.gst.on && n > 0) {
          const a = computeAmounts(n, f.gst);
          note.textContent = f.gst.mode === 'incl'
            ? `Includes ₹${num(a.gstAmount)} GST · base ₹${num(a.base)}`
            : `+ ₹${num(a.gstAmount)} GST = ₹${num(a.total)} total`;
        } else if (f.type === 'transfer' && f.toAccountId) {
          note.textContent = `${accName(f.accountId)} → ${accName(f.toAccountId)}`;
        } else {
          note.textContent = f.date === todayISO() ? '' : dayLabel(f.date);
        }
        $('[data-save]').disabled = !valid();
      }

      function paintDir() {
        root.querySelectorAll('[data-dir]').forEach((b) => {
          const on_ = b.dataset.dir === f.type;
          b.classList.toggle('on', on_);
          b.classList.toggle('in', b.dataset.dir === 'in');
          b.classList.toggle('out', b.dataset.dir === 'out');
        });
        $('[data-cats]').innerHTML = catsHTML(f);
        $('[data-save]').textContent = saveLabel(f, editing);
      }

      function paintAccounts() {
        $('[data-accts]').innerHTML = acctsHTML(f);
      }

      async function paintPhotos() {
        photoRecs = [];
        for (const id of f.photoIds) {
          const rec = await photos.get(id);
          if (rec) photoRecs.push(rec);
        }
        const wrap = $('[data-thumbs]');
        if (!wrap) return;
        wrap.innerHTML = photoRecs.map((p) => `
          <div class="thumb">
            <img src="${blobURL(p)}" alt="Bill">
            <button class="x" data-rmphoto="${p.id}" aria-label="Remove">${icon('close', 13)}</button>
            <div class="badge ${p.status === 'uploaded' ? 'up' : ''}">${p.status === 'uploaded' ? 'On Drive' : 'On phone'}</div>
          </div>`).join('');
        const hint = $('[data-photohint]');
        if (hint) hint.textContent = photoStatusText(photoRecs, reading);
      }

      function paintAll() { paintDir(); paintAccounts(); paintAmount(); paintPhotos(); }

      /* ── numpad ───────────────────────────────────────────── */
      on(root, '[data-key]', (e, b) => {
        const k = b.dataset.key;
        haptic(6);
        if (k === 'del') f.amount = f.amount.slice(0, -1);
        else if (k === '.') { if (!f.amount.includes('.')) f.amount = (f.amount || '0') + '.'; }
        else if (k === '000') { if (f.amount && f.amount !== '0') f.amount += '000'; }
        else {
          if (f.amount === '0') f.amount = '';
          const next = f.amount + k;
          if (/^\d{0,9}(\.\d{0,2})?$/.test(next)) f.amount = next;
        }
        paintAmount();
      });

      /* ── direction / category / account ───────────────────── */
      on(root, '[data-dir]', (e, b) => {
        f.type = b.dataset.dir;
        if (f.type === 'transfer') {
          f.categoryId = '';
          if (!f.toAccountId) {
            const other = accounts().find((a) => a.id !== f.accountId);
            f.toAccountId = other ? other.id : '';
          }
        } else if (!f.categoryId || !categories(f.type).some((c) => c.id === f.categoryId)) {
          f.categoryId = defaultCategory(f.type);
        }
        haptic();
        paintAll();
      });

      on(root, '[data-cat]', (e, b) => {
        f.categoryId = b.dataset.cat;
        $('[data-cats]').innerHTML = catsHTML(f);
        paintAmount();
      });

      on(root, '[data-acct]', (e, b) => {
        const id = b.dataset.acct;
        if (f.type === 'transfer' && b.dataset.side === 'to') f.toAccountId = id;
        else {
          f.accountId = id;
          if (f.type === 'transfer' && f.toAccountId === id) {
            const other = accounts().find((a) => a.id !== id);
            f.toAccountId = other ? other.id : '';
          }
        }
        haptic();
        paintAccounts();
        paintAmount();
      });

      /* ── disclosure ───────────────────────────────────────── */
      on(root, '[data-disclose]', () => {
        $('.disclose').classList.toggle('open');
      });

      /* ── detail fields ────────────────────────────────────── */
      root.addEventListener('input', (e) => {
        const t = e.target;
        if (t.matches('[data-f=date]')) { f.date = t.value || todayISO(); paintAmount(); }
        if (t.matches('[data-f=job]')) { f.jobCode = t.value.toUpperCase(); t.value = f.jobCode; showJobHint($, f); }
        if (t.matches('[data-f=party]')) f.party = t.value;
        if (t.matches('[data-f=note]')) f.note = t.value;
      });

      on(root, '[data-jobpick]', (e, b) => {
        f.jobCode = b.dataset.jobpick;
        const input = $('[data-f=job]');
        if (input) input.value = f.jobCode;
        showJobHint($, f);
      });

      /* ── GST ──────────────────────────────────────────────── */
      on(root, '[data-gst-toggle]', () => {
        f.gst.on = !f.gst.on;
        $('[data-gstbox]').innerHTML = gstHTML(f);
        paintAmount();
      });
      on(root, '[data-gst-mode]', (e, b) => {
        f.gst.mode = b.dataset.gstMode;
        $('[data-gstbox]').innerHTML = gstHTML(f);
        paintAmount();
      });
      root.addEventListener('change', (e) => {
        if (e.target.matches('[data-gst-rate]')) {
          f.gst.rate = Number(e.target.value);
          $('[data-gstbox]').innerHTML = gstHTML(f);
          paintAmount();
        }
      });

      /* ── photos ───────────────────────────────────────────── */
      async function addPhoto() {
        const files = await pickImage({ camera: true });
        if (!files.length) return;
        try {
          const rec = await attach(files[0], entry ? entry.id : '');
          f.photoIds.push(rec.id);
          await paintPhotos();
          toast('Bill saved on this phone');
          if ((aiConfigured() || sharedDrive()) && online()) {
            reading = true;
            await paintPhotos();
            try {
              const got = await readBill(rec);
              applyExtraction(f, got);
              paintAll();
              toast(got.confidence === 'low' ? 'Read it, but check the figures' : 'Bill read — check and save', got.confidence === 'low' ? 'warn' : '');
            } catch (err) {
              toast(String(err.message || err), 'warn', 3200);
            } finally {
              reading = false;
              await paintPhotos();
            }
          }
        } catch (err) {
          toast(String(err.message || err), 'err');
        }
      }

      on(root, '[data-photo]', addPhoto);
      on(root, '[data-addphoto]', addPhoto);
      on(root, '[data-rmphoto]', async (e, b) => {
        const id = b.dataset.rmphoto;
        await detach(id);
        f.photoIds = f.photoIds.filter((x) => x !== id);
        await paintPhotos();
      });

      /* ── save / delete ────────────────────────────────────── */
      function valid() {
        const n = Number(f.amount || 0);
        if (!(n > 0)) return false;
        if (f.type === 'transfer') return !!f.toAccountId && f.toAccountId !== f.accountId;
        return true;
      }

      on(root, '[data-save]', async () => {
        if (!valid()) return;
        const payload = {
          type: f.type,
          entered: Number(f.amount),
          accountId: f.accountId,
          toAccountId: f.toAccountId,
          categoryId: f.type === 'transfer' ? '' : f.categoryId,
          date: f.date,
          jobCode: f.jobCode,
          party: f.party,
          note: f.note,
          gst: f.type === 'transfer' ? { on: false, rate: 0, mode: 'excl' } : f.gst,
          photoIds: f.photoIds,
        };
        const saved = editing ? updateEntry(entry.id, payload) : addEntry(payload);
        if (f.jobCode) ensureJob(f.jobCode, { client: f.party });
        await bindToEntry(f.photoIds, saved.id);
        haptic(14);
        burst();
        toast(editing ? 'Entry updated' : `${f.type === 'in' ? 'Received' : f.type === 'out' ? 'Paid' : 'Moved'} ${inr(saved.total)}`);
        if (canUpload() && online()) syncPending().catch(() => {});
        sheet.close();
        if (onSaved) onSaved(saved);
      });

      on(root, '[data-delete]', async () => {
        const ok = await confirmSheet({
          title: 'Delete this entry?',
          message: 'It will be removed from the ledger and your account balances. This cannot be undone.',
          confirmLabel: 'Delete entry',
          danger: true,
        });
        if (!ok) return;
        for (const id of f.photoIds) await detach(id);
        deleteEntry(entry.id);
        toast('Entry deleted');
        sheet.close();
        if (onSaved) onSaved(null);
      });

      paintAll();
      showJobHint($, f);
    },
  });

  return sheet;
}

/* ── HTML pieces ───────────────────────────────────────────── */

function bodyHTML(f) {
  return `
    <div class="dirchips">
      <button class="dirchip" data-dir="in">${icon('arrowIn', 19)}<span>Money in</span></button>
      <button class="dirchip" data-dir="out">${icon('arrowOut', 19)}<span>Money out</span></button>
      <button class="dirchip" data-dir="transfer">${icon('swap', 19)}<span>Transfer</span></button>
    </div>

    <div class="amount-wrap">
      <div class="amount zero" data-amount><span class="cur">₹</span>0</div>
      <div class="amount-rule"></div>
      <div class="amount-note" data-note></div>
    </div>

    <div class="tray">
      <div class="numgrid">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => `<button data-key="${k}">${k}</button>`).join('')}
        <button data-key="000" class="act">000</button>
        <button data-key="0">0</button>
        <button data-key="del" class="act" aria-label="Backspace">⌫</button>
      </div>

      <div data-cats></div>

      <p class="tray-lbl sp">Particulars</p>
      <textarea class="control" data-f="note" placeholder="What this was for">${esc(f.note)}</textarea>

      <div data-accts></div>

      <div class="disclose">
        <button class="disclose-btn" data-disclose>
          More details <span class="caret">${icon('chevD', 15)}</span>
        </button>
        <div class="disclose-body">${detailsHTML(f)}</div>
      </div>
    </div>

    <div style="flex:none;padding:0 16px 14px;background:var(--page)">
      <button class="btn" data-save disabled>Save</button>
    </div>`;
}

function catsHTML(f) {
  if (f.type === 'transfer') return '';
  const list = categories(f.type);
  if (!list.length) return `<p class="tray-lbl sp">No categories — add one in Settings</p>`;
  return `
    <p class="tray-lbl sp">${f.type === 'in' ? 'Received for' : 'Paid for'}</p>
    <div class="catgrid">
      ${list.map((c) => `<button class="cat ${c.id === f.categoryId ? 'on' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}
    </div>`;
}

function acctsHTML(f) {
  const list = accounts();
  const label = f.type === 'in' ? 'Received in' : f.type === 'out' ? 'Paid from' : 'Move from';
  const one = (a, side, selected) => `
    <button class="acct ${selected ? 'on' : ''}" data-acct="${a.id}" data-side="${side}">
      <div class="acct-top">${icon(a.icon || 'wallet', 19)}<span class="acct-dot"></span></div>
      <div class="acct-n">${esc(a.name)}</div>
      <div class="acct-b num">${inr(balance(a.id))}</div>
    </button>`;

  let html = `
    <p class="tray-lbl sp">${label}</p>
    <div class="acct-row">${list.map((a) => one(a, 'from', a.id === f.accountId)).join('')}</div>`;

  if (f.type === 'transfer') {
    html += `
      <p class="tray-lbl sp">Move to</p>
      <div class="acct-row">${list.filter((a) => a.id !== f.accountId).map((a) => one(a, 'to', a.id === f.toAccountId)).join('')}</div>`;
  }
  return html;
}

function detailsHTML(f) {
  const codes = recentJobCodes(10);
  const parties = recentParties(30);
  return `
    <div class="field-2">
      <div class="field">
        <label>Date</label>
        <input class="control" type="date" data-f="date" value="${esc(f.date)}">
      </div>
      <div class="field">
        <label>Job / MR No.</label>
        <input class="control" type="text" data-f="job" value="${esc(f.jobCode)}"
               placeholder="B109" autocapitalize="characters" autocomplete="off">
      </div>
    </div>
    ${codes.length ? `<div class="chipbar" style="margin:-4px 0 12px">
      ${codes.map((c) => `<button class="chip" data-jobpick="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>` : ''}
    <div class="hint" data-jobhint style="margin:-6px 0 12px"></div>

    <div class="field">
      <label>Party</label>
      <input class="control" type="text" data-f="party" value="${esc(f.party)}"
             placeholder="Client, subcontractor or shop" autocomplete="off" list="partylist">
      <datalist id="partylist">${parties.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    </div>

    <p class="tray-lbl sp">GST</p>
    <div data-gstbox>${gstHTML(f)}</div>

    <p class="tray-lbl sp">Bill photo</p>
    <button class="photo-add" data-addphoto>${icon('camera', 19)} Add a photo of the bill</button>
    <div class="photo-thumbs" data-thumbs></div>
    <div class="hint" data-photohint></div>

    <button class="btn danger sm" data-delete style="display:${f.__canDelete ? 'block' : 'none'}">Delete entry</button>`;
}

function gstHTML(f) {
  if (f.type === 'transfer') return `<div class="hint">GST does not apply to a transfer between your own accounts.</div>`;
  const n = Number(f.amount || 0);
  const a = computeAmounts(n, f.gst);
  return `
    <div class="switchrow" data-gst-toggle>
      <div>
        <div class="sw-t">Apply GST</div>
        <div class="sw-s">${f.gst.on ? `${f.gst.rate}% · ${f.gst.mode === 'incl' ? 'inside the amount' : 'on top'}` : 'Off'}</div>
      </div>
      <div class="switch ${f.gst.on ? 'on' : ''}"></div>
    </div>
    ${f.gst.on ? `
      <div class="field-2">
        <div class="field">
          <label>Rate</label>
          <select class="control" data-gst-rate>
            ${RATES.map((r) => `<option value="${r}" ${r === Number(f.gst.rate) ? 'selected' : ''}>${r}%</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Amount typed is</label>
          <div class="toggle2">
            <button data-gst-mode="excl" class="${f.gst.mode === 'excl' ? 'on' : ''}">Before GST</button>
            <button data-gst-mode="incl" class="${f.gst.mode === 'incl' ? 'on' : ''}">GST inside</button>
          </div>
        </div>
      </div>
      <div class="kv"><span>Taxable value</span><b class="num">${inr(a.base)}</b></div>
      <div class="kv"><span>GST ${f.gst.rate}%</span><b class="num">${inr(a.gstAmount)}</b></div>
      <div class="kv"><span>Total ${f.type === 'in' ? 'received' : 'paid'}</span><b class="num">${inr(a.total)}</b></div>
    ` : ''}`;
}

/* ── helpers ───────────────────────────────────────────────── */

function accName(id) {
  const a = accounts(true).find((x) => x.id === id);
  return a ? a.name : '—';
}

function defaultCategory(type) {
  const meta = raw().meta;
  const want = type === 'in' ? meta.lastCategoryIn : meta.lastCategoryOut;
  const list = categories(type);
  if (want && list.some((c) => c.id === want)) return want;
  return list.length ? list[0].id : '';
}

function prettyAmount(v) {
  const [i, d] = String(v).split('.');
  const withCommas = new Intl.NumberFormat('en-IN').format(Number(i || 0));
  return d === undefined ? withCommas : `${withCommas}.${d}`;
}

function saveLabel(f, editing) {
  if (editing) return 'Save changes';
  return f.type === 'in' ? 'Save money in' : f.type === 'out' ? 'Save money out' : 'Save transfer';
}

function photoStatusText(recs, reading) {
  if (reading) return 'Reading the bill with Claude…';
  if (!recs.length) return (aiConfigured() || sharedDrive())
    ? 'Photos are read automatically when you are online.'
    : 'Photos stay on this phone. Add a Google account and API key in Settings to upload and auto-read them.';
  const pending = recs.filter((r) => r.status !== 'uploaded').length;
  const size = recs.reduce((s, r) => s + (r.bytes || 0), 0);
  return pending
    ? `${pending} waiting to upload · ${humanBytes(size)} on this phone`
    : `Backed up to Drive · ${humanBytes(size)}`;
}

function showJobHint($, f) {
  const el = $('[data-jobhint]');
  if (!el) return;
  if (!f.jobCode) { el.textContent = ''; return; }
  const j = getJob(f.jobCode);
  if (!j) { el.textContent = `New job — ${f.jobCode} will be created.`; return; }
  const bits = [j.title || j.client || 'Existing job'];
  if (j.orderValue) bits.push(`order ${inr(j.orderValue)}`);
  el.textContent = bits.join(' · ');
}

/** Folds whatever Claude could read into the form, never over a typed value. */
function applyExtraction(f, got) {
  if (!got) return;
  if (got.amount && !Number(f.amount)) f.amount = String(got.amount);
  if (got.date && /^\d{4}-\d{2}-\d{2}$/.test(got.date)) f.date = got.date;
  if (got.party && !f.party) f.party = got.party;
  if (got.particulars && !f.note) f.note = got.particulars;
  if (got.direction === 'in' || got.direction === 'out') f.type = got.direction;
  if (got.gstRate) {
    f.gst.on = true;
    f.gst.rate = Number(got.gstRate);
    f.gst.mode = got.gstInclusive === false ? 'excl' : 'incl';
    // The read total already contains GST unless the bill said otherwise.
    if (got.gstInclusive === false && got.base) f.amount = String(got.base);
  }
  if (got.categoryGuess) {
    const hit = categories(f.type === 'transfer' ? 'out' : f.type)
      .find((c) => c.name.toLowerCase() === String(got.categoryGuess).toLowerCase());
    if (hit) f.categoryId = hit.id;
  }
  if (got.invoiceNo && !f.note) f.note = `Invoice ${got.invoiceNo}`;
}

/* ── Entry detail (tap a row in the ledger) ────────────────── */

export function openEntryDetail(id, onChanged) {
  const e = getEntry(id);
  if (!e) return;
  const cat = e.type === 'transfer' ? `${accName(e.accountId)} → ${accName(e.toAccountId)}` : catName(e.categoryId);
  const kind = e.type === 'in' ? 'Money in' : e.type === 'out' ? 'Money out' : 'Transfer';

  const sheet = openSheet({
    title: 'Entry',
    body: `
      <div class="sheet-body">
        <div style="text-align:center;padding:6px 0 16px">
          <div class="pill ${e.type === 'in' ? 'in' : e.type === 'out' ? 'out' : 'mut'}">${kind}</div>
          <div style="font-size:34px;font-weight:600;letter-spacing:-1px;margin-top:9px"
               class="num ${e.type === 'in' ? '' : ''}">${inr(e.total)}</div>
          <div style="font-size:12.5px;color:var(--ink-3);margin-top:3px">${esc(dmy(e.date))}</div>
        </div>

        <div class="list" style="padding:2px 14px">
          <div class="kv"><span>${e.type === 'transfer' ? 'Route' : 'Category'}</span><b>${esc(cat)}</b></div>
          ${e.type !== 'transfer' ? `<div class="kv"><span>Account</span><b>${esc(accName(e.accountId))}</b></div>` : ''}
          ${e.jobCode ? `<div class="kv"><span>Job</span><b>${esc(e.jobCode)}</b></div>` : ''}
          ${e.party ? `<div class="kv"><span>Party</span><b>${esc(e.party)}</b></div>` : ''}
          ${e.note ? `<div class="kv"><span>Particulars</span><b>${esc(e.note)}</b></div>` : ''}
          ${e.gst && e.gst.on ? `
            <div class="kv"><span>Taxable value</span><b class="num">${inr(e.base)}</b></div>
            <div class="kv"><span>GST ${e.gst.rate}%</span><b class="num">${inr(e.gstAmount)}</b></div>` : ''}
          <div class="kv"><span>Logged</span><b>${new Date(e.createdAt).toLocaleString('en-IN')}</b></div>
          ${e.edited ? `<div class="kv"><span>Edited</span><b>${e.history.length} change${e.history.length > 1 ? 's' : ''} after 24h</b></div>` : ''}
        </div>

        <div data-photos></div>

        <button class="btn" data-edit>Edit entry</button>
        <button class="btn sec sm" data-repeat>Log another like this</button>
      </div>`,
    async onMount(root) {
      const wrap = root.querySelector('[data-photos]');
      const recs = [];
      for (const pid of (e.photoIds || [])) {
        const r = await photos.get(pid);
        if (r) recs.push(r);
      }
      if (recs.length) {
        wrap.innerHTML = `
          <p class="tray-lbl sp">Bill</p>
          <div class="photo-thumbs">
            ${recs.map((p) => `
              <a class="thumb" href="${p.driveLink || blobURL(p)}" ${p.driveLink ? 'target="_blank" rel="noopener"' : ''}>
                <img src="${blobURL(p)}" alt="Bill">
                <div class="badge ${p.status === 'uploaded' ? 'up' : ''}">${p.status === 'uploaded' ? 'On Drive' : 'On phone'}</div>
              </a>`).join('')}
          </div>`;
      }

      on(root, '[data-edit]', () => {
        sheet.close();
        setTimeout(() => openEntrySheet({ entry: getEntry(id), onSaved: onChanged }), 210);
      });
      on(root, '[data-repeat]', () => {
        sheet.close();
        const src = getEntry(id);
        setTimeout(() => openEntrySheet({
          prefill: { ...src, entered: src.entered, date: todayISO() },
          onSaved: onChanged,
        }), 210);
      });
    },
  });
}

function catName(id) {
  const c = categories(null, true).find((x) => x.id === id);
  return c ? c.name : 'Uncategorised';
}
