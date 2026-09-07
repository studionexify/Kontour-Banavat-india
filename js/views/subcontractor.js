/* views/subcontractor.js — who is making it, and what they are owed.
 *
 * Banavat India does not make everything in one shed: metal goes to
 * one person, wood to another, upholstery to a third, drawings to
 * someone else again. This is where that is run from.
 *
 * The screen is the Drive folder made live. A list of people, each
 * with one running balance; open a person and you get exactly what
 * their sheet held — the work orders issued to them, every piece on
 * each one with its photo and the rate they quoted, and every payment
 * ever made to them — except that the balance is computed rather than
 * typed, so it cannot drift.
 *
 * Commissioning work happens the way it always has: pull up an
 * ongoing order, pick the line items, hand them to somebody, write
 * down what they quoted. That flow lives in views/assignwork.js and is
 * reached both from here and from inside an order.
 *
 * Money only moves in one direction here. Assigning a piece and
 * agreeing a rate is a commitment — it shows as owed and touches
 * nothing else. Recording a payment is a rupee actually leaving, so
 * that, and only that, writes to the day book.
 */

import { esc, on, openSheet, confirmSheet, toast, field, haptic } from '../ui.js';
import { inr, dmy, todayISO, round2 } from '../format.js';
import * as subs from '../subs.js';
import { loadArchive } from '../subphoto.js';
import { pageHead, statCards, searchBar, nothingHere, sectionHead } from './chrome.js';
import { seedingAllowed } from '../shopsync.js';
import { openAssign } from './assignwork.js';
import { openWorkOrder } from './workorder.js';
import { wire } from './production.js';

let query = '';
let filter = 'all';   // all | owing | blacklisted | archived

const FILTERS = [
  { id: 'all', label: 'Everyone' },
  { id: 'owing', label: 'Money owed' },
  { id: 'blacklisted', label: 'Blacklisted' },
  { id: 'archived', label: 'Archived' },
];

export async function render(root, ctx) {
  subs.load();
  // The scanned photographs, so a piece whose quotation is not on this
  // device still shows its picture. Cheap after the first call.
  await loadArchive();

  // The eleven histories out of the Drive folder, once. Held back on
  // shared books until a pull has landed, so a phone that signs in and
  // opens this screen before the first sync finishes does not seed a
  // second copy of a history the books already hold. See
  // shopsync.seedingAllowed().
  if (seedingAllowed() && !subs.seeded()) {
    const r = await subs.seedFromFile();
    if (r.seeded) toast(`Loaded ${r.seeded} sub-contractors from the work order sheets`);
  }

  const s = subs.stats();
  const list = listFor();

  root.innerHTML = `
    <div class="floor">
      ${pageHead({
        title: 'Sub-Contractor',
        sub: `${s.people} on the books${s.blacklisted ? ` · ${s.blacklisted} blacklisted` : ''}`,
        actions: `<button class="btn sm" data-add>Add sub-contractor</button>`,
      })}

      ${statCards([
        { label: 'Work ordered', value: inr(s.ordered), tone: 'sub' },
        { label: 'Paid', value: inr(s.paid), hint: 'against those orders' },
        { label: 'Outstanding', value: inr(s.owed), hint: s.owing ? `${s.owing} to settle` : 'all settled' },
      ])}

      <div class="chipbar" style="margin:14px 0 4px">
        ${FILTERS.map((f) => `<button class="chip ${filter === f.id ? 'on' : ''}" data-filter="${f.id}">${esc(f.label)}</button>`).join('')}
      </div>

      ${searchBar(query, 'Search a name, a firm or a trade')}

      ${sectionHead(filter === 'all' ? 'By balance' : FILTERS.find((f) => f.id === filter).label)}
      ${list.length
        ? `<div class="vgrid">${list.map(card).join('')}</div>`
        : nothingHere('hands',
            query ? 'No sub-contractor matches' : emptyTextFor(),
            query ? 'Try another search' : 'Add one, or commission work from inside an order')}

      ${filter === 'all' && !query ? assignCta() : ''}
    </div>`;

  wire(root, ctx, { onSearch: (v) => { query = v; } });
  on(root, '[data-filter]', (e, b) => { filter = b.dataset.filter; ctx.refresh(); });
  on(root, '[data-add]', () => openEditor(null, ctx));
  on(root, '[data-sub]', (e, b) => openPerson(b.dataset.sub, ctx));
  on(root, '[data-assign]', () => openAssign({ onDone: ctx.refresh }));
}

function emptyTextFor() {
  if (filter === 'owing') return 'Nobody is owed anything';
  if (filter === 'blacklisted') return 'Nobody is blacklisted';
  if (filter === 'archived') return 'Nothing archived';
  return 'No sub-contractors yet';
}

function assignCta() {
  return `
    <div class="tray-lbl sp">Commission work</div>
    <button class="btn sec" data-assign>Assign line items from an order</button>`;
}

function listFor() {
  const opts = { q: query, includeArchived: filter === 'archived' };
  let list = filter === 'archived' ? subs.subs({ status: 'archived', q: query })
    : filter === 'blacklisted' ? subs.subs({ status: 'blacklisted', q: query })
      : subs.subs(opts);

  const withBal = list.map((s) => ({ s, bal: subs.balanceOf(s.id) }));
  if (filter === 'owing') return withBal.filter((r) => r.bal.due > 0)
    .sort((a, b) => b.bal.due - a.bal.due).map((r) => r);

  // Whoever is owed the most, first: this screen is read to answer
  // "who do we still have to pay", not to browse an address book.
  return withBal.sort((a, b) => b.bal.due - a.bal.due || a.s.name.localeCompare(b.s.name));
}

function card({ s, bal }) {
  const trades = (s.trades || []).map((t) => subs.TRADE_LABELS[t] || t).join(' · ');
  const firm = s.firm && s.firm !== s.name ? s.firm : '';
  const sub = [firm, trades].filter(Boolean).join(' · ');
  return `
    <button class="vcard" data-sub="${esc(s.id)}">
      <span class="vcard-ini">${esc(initials(s.name))}</span>
      <span class="vcard-txt">
        <span class="vcard-n">${esc(s.name)}
          ${s.status === 'blacklisted' ? '<span class="pill out sm">BLACKLISTED</span>' : ''}
          ${s.status === 'archived' ? '<span class="pill mut sm">ARCHIVED</span>' : ''}
        </span>
        <span class="vcard-s">${esc(sub || 'No trade recorded')}</span>
      </span>
      <span class="vcard-c ${bal.due > 0 ? 'due' : ''}">${bal.due > 0 ? esc(inr(bal.due)) : '—'}</span>
    </button>`;
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ── One person's whole board ──────────────────────────────────
   Their balance, their work orders, and their payments — the two
   tabs of their Drive sheet on one screen. */

export function openPerson(id, ctx) {
  const s = subs.getSub(id);
  if (!s) return;

  const draw = (sheet, handle) => {
    const bal = subs.balanceOf(id);
    const wos = subs.workOrdersOf(id);
    const pays = subs.paymentsOf(id);
    const trades = (s.trades || []).map((t) => subs.TRADE_LABELS[t] || t);

    sheet.querySelector('.sheet-body').innerHTML = `
      ${s.status === 'blacklisted' ? `
        <div class="notice bad">
          <strong>Blacklisted${s.blacklistDate ? ` on ${esc(dmy(s.blacklistDate))}` : ''}</strong>
          ${s.blacklistReason ? `<p>${esc(s.blacklistReason)}</p>` : ''}
          <p class="hint">They cannot be given new work. Their balance below still stands.</p>
        </div>` : ''}
      ${s.status === 'archived' ? `
        <div class="notice">
          <strong>Archived</strong>
          <p class="hint">Kept out of the lists. Nothing has been deleted.</p>
        </div>` : ''}
      ${s.dataNote ? `
        <div class="notice warn">
          <strong>Check this</strong>
          <p>${esc(s.dataNote)}</p>
        </div>` : ''}

      <div class="tags" style="margin-bottom:14px">
        ${trades.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
      </div>

      <div class="kpis" style="margin-bottom:8px">
        <div class="kpi">
          <div class="kpi-l">WORK ORDERED</div>
          <div class="kpi-v num">${esc(inr(bal.ordered))}</div>
          <div class="kpi-s">${wos.length} work order${wos.length === 1 ? '' : 's'} · ${subs.itemsOf(id).length} pieces</div>
        </div>
        <div class="kpi">
          <div class="kpi-l">PAID</div>
          <div class="kpi-v num in">${esc(inr(bal.paid))}</div>
          <div class="kpi-s">${pays.length} payment${pays.length === 1 ? '' : 's'}</div>
        </div>
      </div>
      <div class="kpi" style="margin-bottom:16px">
        <div class="kpi-l">${bal.due < 0 ? 'OVERPAID BY' : 'REMAINING'}</div>
        <div class="kpi-v num ${bal.due > 0 ? 'out' : ''}">${esc(inr(Math.abs(bal.due)))}</div>
      </div>

      ${(s.phone || s.email || s.address) ? `
        <p class="tray-lbl">Contact</p>
        <div class="plist" style="margin-bottom:16px">
          ${s.phone ? `<a class="prow" href="tel:${esc(s.phone)}"><span class="prow-txt"><span class="prow-t">${esc(s.phone)}</span><span class="prow-s">Phone</span></span></a>` : ''}
          ${s.email ? `<a class="prow" href="mailto:${esc(s.email)}"><span class="prow-txt"><span class="prow-t">${esc(s.email)}</span><span class="prow-s">Email</span></span></a>` : ''}
          ${s.address ? `<div class="prow"><span class="prow-txt"><span class="prow-t">${esc(s.address)}</span><span class="prow-s">Address</span></span></div>` : ''}
        </div>` : ''}

      <p class="tray-lbl">Work orders</p>
      ${wos.length ? `
        <div class="plist">
          ${wos.map((w) => {
            const items = subs.itemsIn(w.id);
            return `
              <button class="prow" data-wo="${esc(w.id)}">
                <span class="prow-txt">
                  <span class="prow-t">${esc(w.no)}</span>
                  <span class="prow-s">${esc(dmy(w.issueDate))} · ${items.length} piece${items.length === 1 ? '' : 's'}</span>
                </span>
                <span class="prow-qty num">${esc(inr(subs.woTotal(w.id)))}</span>
              </button>`;
          }).join('')}
        </div>` : '<p class="hint">Nothing commissioned to them yet.</p>'}

      ${s.status === 'blacklisted'
        ? '<p class="hint" style="margin-top:10px">Blacklisted — un-flag them below to commission new work.</p>'
        : `<button class="btn sec sm" data-new-wo>New work order</button>`}

      <p class="tray-lbl sp">Payments</p>
      ${pays.length ? `
        <div class="plist">
          ${pays.map((p) => `
            <button class="prow" data-pay="${esc(p.id)}">
              <span class="prow-txt">
                <span class="prow-t">${esc(p.remarks || 'Payment')}</span>
                <span class="prow-s">${esc(dmy(p.date))} · ${esc(p.mode)}${p.note ? ` · ${esc(p.note)}` : ''}${p.entryId ? '' : ' · not in ledger'}</span>
              </span>
              <span class="prow-qty num">${esc(inr(p.amount))}</span>
            </button>`).join('')}
        </div>` : '<p class="hint">Nothing paid to them yet.</p>'}
      <button class="btn sm" data-pay-new>Record a payment</button>

      <p class="tray-lbl sp">This sub-contractor</p>
      <button class="btn sec sm" data-edit>Edit details</button>
      ${s.status === 'blacklisted'
        ? `<button class="btn sec sm" data-unblack>Remove blacklist</button>`
        : `<button class="btn danger sm" data-black>Flag as blacklisted</button>`}
      ${s.status === 'archived'
        ? `<button class="btn sec sm" data-unarchive>Restore from archive</button>`
        : `<button class="btn sec sm" data-archive>Archive</button>`}
      <button class="btn danger sm" data-delete>Delete</button>`;

    bind(sheet, handle);
  };

  const bind = (sheet, handle) => {
    const refresh = () => { draw(sheet, handle); if (ctx) ctx.refresh(); };

    on(sheet, '[data-wo]', (e, b) => openWorkOrder(b.dataset.wo, { onDone: refresh }));
    on(sheet, '[data-new-wo]', () => openAssign({ subId: id, onDone: refresh }));
    on(sheet, '[data-pay]', (e, b) => openPayment(subs.getPayment(b.dataset.pay), id, refresh));
    on(sheet, '[data-pay-new]', () => openPayment(null, id, refresh));
    on(sheet, '[data-edit]', () => openEditor(id, { refresh: () => { refresh(); } }));

    on(sheet, '[data-black]', async () => {
      const done = await openBlacklist(s);
      if (done) refresh();
    });
    on(sheet, '[data-unblack]', async () => {
      const ok = await confirmSheet({
        title: 'Remove blacklist',
        message: `${s.name} can be given new work again.`,
        confirmLabel: 'Remove',
      });
      if (ok) { subs.unBlacklist(id); toast('Blacklist removed'); refresh(); }
    });

    on(sheet, '[data-archive]', async () => {
      const ok = await confirmSheet({
        title: 'Archive this sub-contractor',
        message: `${s.name} is taken out of the lists and the assign screen. Their work orders, payments and balance stay exactly as they are, and you can restore them at any time.`,
        confirmLabel: 'Archive',
      });
      if (ok) { subs.archive(id); toast('Archived'); handle.close(); if (ctx) ctx.refresh(); }
    });
    on(sheet, '[data-unarchive]', () => { subs.unarchive(id); toast('Restored'); refresh(); });

    on(sheet, '[data-delete]', async () => {
      const h = subs.historyOf(id);
      if (!h.empty) {
        // Refused rather than warned. A subcontractor with history has
        // a balance somebody may still have to settle, and no
        // confirmation dialog is worth losing that to a mis-tap.
        await confirmSheet({
          title: 'Cannot delete',
          message: `${s.name} has ${h.workOrders} work order${h.workOrders === 1 ? '' : 's'}, ${h.items} piece${h.items === 1 ? '' : 's'} and ${h.payments} payment${h.payments === 1 ? '' : 's'} totalling ${inr(h.paid)} on file. Deleting would take that history with them. Archive them instead — it removes them from every list and keeps the record.`,
          confirmLabel: 'I understand',
        });
        return;
      }
      const ok = await confirmSheet({
        title: `Delete ${s.name}?`,
        message: 'Nothing has been commissioned to them and nothing paid, so there is no history to lose.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (ok && subs.deleteSub(id)) { toast('Deleted'); handle.close(); if (ctx) ctx.refresh(); }
    });
  };

  openSheet({
    title: s.name,
    full: true,
    body: '<div class="sheet-body"></div>',
    onMount(sheet, handle) { draw(sheet, handle); },
  });
}

/* ── Add and edit ──────────────────────────────────────────────
   Aliases are on this form on purpose. The order sheet has been
   calling Vikas Jangid "Vikas Bhai" for a year; typing that in here is
   what makes the two the same person rather than two half-balances. */

export function openEditor(id, ctx) {
  const s = id ? subs.getSub(id) : null;
  const v = s || { name: '', firm: '', aliases: [], trades: [], phone: '', email: '', address: '', notes: '' };

  openSheet({
    title: s ? 'Edit sub-contractor' : 'Add sub-contractor',
    body: `
      <div class="sheet-body">
        ${field('Name', `<input class="inp" data-f="name" value="${esc(v.name)}" placeholder="Dinesh Chaudhary" autocomplete="off">`)}
        ${field('Firm', `<input class="inp" data-f="firm" value="${esc(v.firm)}" placeholder="Shree Vishwakarma Interior &amp; Woods" autocomplete="off">`, 'Optional — the business name, if it differs from theirs')}

        ${field('Trades', `
          <div class="chipbar" data-trades>
            ${subs.TRADES.map((t) => `
              <button type="button" class="chip ${v.trades.includes(t) ? 'on' : ''}" data-trade="${t}">${esc(subs.TRADE_LABELS[t])}</button>`).join('')}
          </div>`, 'What you send them')}

        ${field('Also known as', `<input class="inp" data-f="aliases" value="${esc((v.aliases || []).join(', '))}" placeholder="Dinesh bhai, Dinesh Bhai" autocomplete="off">`,
          'Other spellings used on order sheets, separated by commas. This is what ties an order line naming them to this record.')}

        ${field('Phone', `<input class="inp" data-f="phone" value="${esc(v.phone)}" inputmode="tel" autocomplete="off">`)}
        ${field('Email', `<input class="inp" data-f="email" value="${esc(v.email)}" inputmode="email" autocomplete="off">`)}
        ${field('Address', `<textarea class="inp" data-f="address" rows="2">${esc(v.address)}</textarea>`)}
        ${field('Notes', `<textarea class="inp" data-f="notes" rows="2">${esc(v.notes)}</textarea>`)}

        <button class="btn" data-save>${s ? 'Save' : 'Add sub-contractor'}</button>
      </div>`,
    onMount(sheet, handle) {
      const picked = new Set(v.trades);
      on(sheet, '[data-trade]', (e, b) => {
        const t = b.dataset.trade;
        if (picked.has(t)) { picked.delete(t); b.classList.remove('on'); }
        else { picked.add(t); b.classList.add('on'); }
        haptic();
      });

      on(sheet, '[data-save]', () => {
        const get = (f) => (sheet.querySelector(`[data-f="${f}"]`).value || '').trim();
        const name = get('name');
        if (!name) { toast('A name is needed', 'bad'); return; }

        // Two records for one person is the failure this whole screen
        // exists to prevent, so the name and every alias are checked
        // against everyone already on file.
        const clash = subs.findByName(name);
        if (clash && clash.id !== id) {
          toast(`${clash.name} is already on file`, 'bad');
          return;
        }

        const payload = {
          name,
          firm: get('firm'),
          aliases: get('aliases').split(',').map((a) => a.trim()).filter(Boolean),
          trades: [...picked],
          phone: get('phone'),
          email: get('email'),
          address: get('address'),
          notes: get('notes'),
        };

        if (s) { subs.updateSub(id, payload); toast('Saved'); }
        else { subs.addSub(payload); toast(`${name} added`); }

        handle.close();
        if (ctx) ctx.refresh();
      });
    },
  });
}

/* ── Blacklisting ──────────────────────────────────────────────
   A reason is required. A flag nobody wrote a reason for is one
   nobody can argue with, or lift, six months later. */

function openBlacklist(s) {
  return new Promise((resolve) => {
    let done = false;
    openSheet({
      title: `Blacklist ${s.name}`,
      body: `
        <div class="sheet-body">
          <p class="hint" style="margin-bottom:14px">
            They will be hidden from the assign screen and cannot be given new work.
            Everything already on file — work orders, pieces, payments and the balance —
            stays exactly as it is, and you can still record a payment to settle what is owed.
          </p>
          ${field('Reason', `<textarea class="inp" data-f="reason" rows="3" placeholder="Repeated delays and quality issues on B121"></textarea>`, 'Required')}
          ${field('Date', `<input class="inp" type="date" data-f="date" value="${todayISO()}">`)}
          <button class="btn danger" data-go>Blacklist</button>
        </div>`,
      onMount(sheet, handle) {
        on(sheet, '[data-go]', () => {
          const reason = (sheet.querySelector('[data-f="reason"]').value || '').trim();
          if (!reason) { toast('Give a reason', 'bad'); return; }
          const date = sheet.querySelector('[data-f="date"]').value || todayISO();
          subs.blacklist(s.id, reason, date);
          toast(`${s.name} blacklisted`);
          done = true;
          handle.close();
        });
      },
      onClose() { resolve(done); },
    });
  });
}

/* ── Payments ──────────────────────────────────────────────────
   The one place this screen writes to the day book. Assigning work
   and agreeing a rate is a promise; this is a rupee leaving, so it is
   logged as one — against the job, with the bill if there is one. */

export function openPayment(pay, subId, refresh) {
  const s = subs.getSub(subId);
  const editing = Boolean(pay);
  const v = pay || { date: todayISO(), amount: '', remarks: '', mode: 'Cash', note: '', jobCode: '', woId: '' };
  const bal = subs.balanceOf(subId);
  const wos = subs.workOrdersOf(subId);

  openSheet({
    title: editing ? 'Payment' : `Pay ${s.name}`,
    body: `
      <div class="sheet-body">
        ${!editing && bal.due > 0 ? `<p class="hint" style="margin-bottom:12px">${esc(inr(bal.due))} outstanding.</p>` : ''}

        ${field('Amount', `<input class="inp num" data-f="amount" inputmode="decimal" value="${v.amount || ''}" placeholder="0">`)}
        ${field('Date', `<input class="inp" type="date" data-f="date" value="${esc(v.date)}">`)}
        ${field('Mode', `
          <select class="inp" data-f="mode">
            ${subs.PAY_MODES.map((m) => `<option ${v.mode === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          </select>`)}
        ${field('Remarks', `<input class="inp" data-f="remarks" value="${esc(v.remarks)}" placeholder="B109 advance" autocomplete="off">`, 'What the payment was for')}
        ${field('Handed to', `<input class="inp" data-f="note" value="${esc(v.note)}" placeholder="To Uttam bhai" autocomplete="off">`, 'Who actually took it, when that is not them')}
        ${field('Against work order', `
          <select class="inp" data-f="woId">
            <option value="">Not tied to one</option>
            ${wos.map((w) => `<option value="${esc(w.id)}" ${v.woId === w.id ? 'selected' : ''}>${esc(w.no)} — ${esc(dmy(w.issueDate))}</option>`).join('')}
          </select>`, 'Optional. The balance is theirs overall, not per work order.')}
        ${field('Job code', `<input class="inp" data-f="jobCode" value="${esc(v.jobCode || '')}" placeholder="B109" autocomplete="off">`, 'Books the ledger entry against this job')}

        ${editing
          ? `<p class="hint">${v.entryId
              ? 'This payment is in the day book.'
              : 'This payment came from the imported sheets and is not in the day book — it was recorded elsewhere at the time.'}</p>`
          : '<p class="hint">Recording this logs money out of the day book as well.</p>'}

        <button class="btn" data-save>${editing ? 'Save' : 'Record payment'}</button>
        ${editing ? '<button class="btn danger sm" data-del>Delete payment</button>' : ''}
      </div>`,
    onMount(sheet, handle) {
      on(sheet, '[data-save]', async () => {
        const get = (f) => (sheet.querySelector(`[data-f="${f}"]`).value || '').trim();
        const amount = round2(Number(get('amount')) || 0);
        if (!(amount > 0)) { toast('Enter an amount', 'bad'); return; }

        const payload = {
          subId,
          date: get('date') || todayISO(),
          amount,
          remarks: get('remarks'),
          mode: get('mode'),
          note: get('note'),
          woId: get('woId'),
          jobCode: get('jobCode'),
        };

        if (editing) {
          subs.updatePayment(pay.id, payload);
          toast('Saved');
        } else {
          const store = await import('../store.js');
          subs.addPayment(payload, { postToLedger: true, ledger: store });
          toast(`${inr(amount)} paid to ${s.name}`);
        }
        handle.close();
        if (refresh) refresh();
      });

      on(sheet, '[data-del]', async () => {
        const ok = await confirmSheet({
          title: 'Delete this payment?',
          message: pay.entryId
            ? 'The matching day book entry is left alone — delete that separately from the ledger if it should go too.'
            : 'It will no longer count against their balance.',
          confirmLabel: 'Delete',
          danger: true,
        });
        if (ok) { subs.deletePayment(pay.id); toast('Deleted'); handle.close(); if (refresh) refresh(); }
      });
    },
  });
}
