/* views/qc.js — QC + Catalog.
 *
 * Two halves of one habit. A piece reaching assembly is a piece
 * ready to be looked at properly before anyone packs it, and what
 * is being looked at is a design the catalog already describes —
 * its dimensions, its finish, the photograph it is supposed to
 * match. Checking and cataloguing belong on the same screen because
 * they are the same act pointed in two directions.
 *
 * QC's queue is every piece standing at assembly (see STATION in
 * orders.js). Passing it sends it to Shipping; failing it sends it
 * back to production, which is the whole point of a check.
 */

import { icon } from '../icons.js';
import { on, esc, toast, haptic, openSheet, field } from '../ui.js';
import { linesAt, getLine, logQc, QC_CHECKS, QC_REASONS } from '../orders.js';
import { designs, CATEGORIES } from '../quotes.js';
import { inr, dmy } from '../format.js';
import { pageHead, statCards, searchBar, nothingHere, sectionHead, comingUp } from './chrome.js';
import { openOrder } from './orderdetail.js';
import { openDesignSheet } from './library.js';
import * as subs from '../subs.js';
import { openItemBoard, stateChip, capturePhotos, photosFor } from './piecework.js';
import { photos, blobURL } from '../db.js';
import { pickImage, shrink } from '../photos.js';
import { uid } from '../store.js';
import { orderGroups } from '../orders.js';

let tab = 'qc';        // 'qc' | 'photos' | 'catalog'
let query = '';
let cat = 'All';

export function render(root, ctx) {
  const queue = linesAt('qc');
  const all = designs();
  // Anything a sub-contractor was told to improve or remake. It is
  // not in the check queue — it has not come back yet — but it is
  // exactly what falls through the cracks, so it is listed here.
  const rework = subs.itemsInState(['improve', 'rejected']);

  root.innerHTML = `
    <div class="floor">
      ${pageHead({
        title: 'QC + Catalog',
        sub: tab === 'qc'
          ? `${queue.length} piece${queue.length === 1 ? '' : 's'} waiting to be checked${rework.length ? ` · ${rework.length} in rework` : ''}`
          : tab === 'photos'
            ? 'Every photograph taken on the floor, project by project'
            : `${all.length} design${all.length === 1 ? '' : 's'} on file`,
        actions: tab === 'catalog'
          ? `<button class="pill-btn" data-adddesign>${icon('plus', 16)} Add design</button>` : '',
      })}

      <div class="segbar" style="margin-bottom:20px">
        <button class="seg-mini ${tab === 'qc' ? 'on' : ''}" data-tab="qc">Quality check</button>
        <button class="seg-mini ${tab === 'photos' ? 'on' : ''}" data-tab="photos">Photographs</button>
        <button class="seg-mini ${tab === 'catalog' ? 'on' : ''}" data-tab="catalog">Catalog</button>
      </div>

      ${tab === 'qc' ? qcHTML(queue, rework)
        : tab === 'photos' ? photosHTML()
        : catalogHTML(all)}
    </div>`;

  on(root, '[data-tab]', (e, b) => { tab = b.dataset.tab; query = ''; ctx.refresh(); });

  /* The row opens the order; the buttons inside it decide the piece.
     Both listeners hang off the same root, so stopping propagation
     on the inner one does not stop this one — the row has to check
     for itself whether the tap landed on an action. */
  on(root, '[data-open]', (e, b) => {
    if (e.target.closest('button')) return;
    openOrder(b.dataset.open, ctx.refresh);
  });
  on(root, '[data-item]', (e, b) => openItemBoard(b.dataset.item, ctx.refresh));
  on(root, '[data-shoot-mr]', async (e, b) => {
    const added = await shootForProject(b.dataset.shootMr);
    if (added) { toast(`${added} photograph${added === 1 ? '' : 's'} filed under ${b.dataset.shootMr}`); ctx.refresh(); }
  });
  if (tab === 'photos') paintGallery(root);
  on(root, '[data-adddesign]', () => openDesignSheet({ onSaved: ctx.refresh }));
  on(root, '[data-editdesign]', (e, b) => openDesignSheet({ code: b.dataset.editdesign, onSaved: ctx.refresh }));
  on(root, '[data-cat]', (e, b) => { cat = b.dataset.cat; ctx.refresh(); });

  on(root, '[data-pass]', (e, b) => {
    e.stopPropagation();
    openCheck(b.dataset.pass, 'pass', ctx.refresh);
  });

  on(root, '[data-fail]', (e, b) => {
    e.stopPropagation();
    openCheck(b.dataset.fail, 'back', ctx.refresh);
  });

  const q = root.querySelector('[data-q]');
  if (q) {
    q.addEventListener('input', () => {
      query = q.value;
      clearTimeout(q._t);
      q._t = setTimeout(() => ctx.refresh(), 220);
    });
  }
}

/* ── The check queue ───────────────────────────────────────── */

function qcHTML(queue, rework) {
  const needle = query.trim().toLowerCase();
  const list = needle
    ? queue.filter((l) => `${l.name} ${l.mrNo} ${l.client}`.toLowerCase().includes(needle))
    : queue;

  return `
    ${statCards([
      { label: 'Awaiting check', value: queue.length, tone: 'qc' },
      { label: 'Pieces', value: queue.reduce((n, l) => n + (l.qty || 1), 0), hint: 'including quantities' },
      { label: 'Orders', value: new Set(queue.map((l) => l.mrNo)).size, hint: 'represented' },
    ])}

    ${comingUp([
      'A piece lands here once every sub-contractor commissioned on it has approved their part. Passing it sends it to Shipping, one piece at a time; sending it back returns it to production.',
      'The checklist is a starting list, taken from what these pieces actually get sent back for. Editing it from Settings comes next — until then, tell me what to add and it goes in.',
    ])}

    ${rework.length ? `
      ${sectionHead('Sent back for rework')}
      <p class="hint" style="margin-bottom:10px">Told to improve or remake, still with the sub-contractor. Open one to see the notes and photographs.</p>
      <div class="plist" style="margin-bottom:22px">${rework.map(reworkRow).join('')}</div>
    ` : ''}

    ${searchBar(query, 'Search piece, client, MR number')}

    ${sectionHead('Waiting to be checked')}
    ${list.length ? `<div class="plist">${list.map(qcRow).join('')}</div>`
      : nothingHere('clipboard', query ? 'Nothing matches' : 'Nothing waiting',
          query ? 'Try another search' : 'Pieces arrive here when they reach assembly')}`;
}

function qcRow(l) {
  // A piece that has been here before says so. Whether this is the
  // first look or the third changes how hard you look.
  const back = (l.qcLog || []).filter((r) => r.result === 'back');
  const bits = [
    l.mrNo,
    l.client || '',
    l.deliveryDate ? `due ${dmy(l.deliveryDate)}` : '',
    back.length ? `sent back ${back.length === 1 ? 'once' : `${back.length} times`}` : '',
  ].filter(Boolean);
  return `
    <article class="prow qcrow" data-open="${esc(l.mrNo)}" tabindex="0" role="button">
      <span class="prow-txt">
        <span class="prow-t">${esc(l.name)}${back.length ? ' <span class="pill warn sm">RECHECK</span>' : ''}</span>
        <span class="prow-s">${esc(bits.join(' · '))}</span>
      </span>
      <span class="qcrow-acts">
        <button class="mini" data-fail="${esc(l.id)}">${icon('back', 13)} Back</button>
        <button class="mini ok" data-pass="${esc(l.id)}">${icon('check', 13)} Pass</button>
      </span>
    </article>`;
}

/* ── One check ─────────────────────────────────────────────────
   Passing or failing a piece is a record, not a click. What was
   looked at is ticked from one list, so the same words are used
   every time and "was the finish checked" is a question with an
   answer; a piece going back carries one chosen reason, for the
   same reason. Photographs and a note are optional on both, and
   every round is kept — a piece that fails twice has two rounds on
   file. See QC_CHECKS in orders.js. */

function openCheck(lineId, result, onDone) {
  const line = getLine(lineId);
  if (!line) return;
  const pass = result === 'pass';
  let shots = [];

  openSheet({
    title: pass ? 'Quality check' : 'Send back',
    body: `
      <div class="sheet-body">
        <p class="sheet-lede">${esc(line.name || 'This piece')} · ${esc(line.mrNo)}${line.client ? ` · ${esc(line.client)}` : ''}</p>

        <p class="tray-lbl">${pass ? 'What was checked' : 'What was checked before it failed'}</p>
        <div class="checklist">
          ${QC_CHECKS.map((c, i) => `
            <label class="checkrow">
              <input type="checkbox" class="box" data-check="${i}" value="${esc(c)}">
              <span>${esc(c)}</span>
            </label>`).join('')}
        </div>
        <button class="btn sec sm" data-all>Tick everything</button>

        ${pass ? '' : `
          ${field('Why it is going back',
            `<select class="control" data-reason>
              ${QC_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
            </select>`)}`}

        ${field(pass ? 'Note' : 'What has to be put right',
          `<textarea class="control" data-note rows="2" placeholder="${esc(pass ? 'Optional' : 'Polish the left arm, the joint shows')}"></textarea>`)}

        <button class="btn sec sm" data-shoot>${icon('camera', 15)} Add photographs</button>
        <div class="shotstrip" data-strip></div>

        <button class="btn ${pass ? '' : 'danger'}" data-save>
          ${pass ? 'Pass — move to Shipping' : 'Send back to production'}
        </button>
      </div>`,
    onMount(sheet, handle) {
      on(sheet, '[data-all]', () => {
        const boxes = [...sheet.querySelectorAll('[data-check]')];
        const every = boxes.every((b) => b.checked);
        boxes.forEach((b) => { b.checked = !every; });
        haptic();
      });

      on(sheet, '[data-shoot]', async () => {
        const ids = await capturePhotos({ orderLineId: line.id, mrNo: line.mrNo });
        if (!ids.length) return;
        shots = [...shots, ...ids];
        const recs = await photosFor(shots);
        sheet.querySelector('[data-strip]').innerHTML = recs
          .map((r) => `<img class="logshot" src="${esc(blobURL(r))}" alt="">`).join('');
      });

      on(sheet, '[data-save]', () => {
        const checks = [...sheet.querySelectorAll('[data-check]')]
          .filter((b) => b.checked).map((b) => b.value);
        const reasonEl = sheet.querySelector('[data-reason]');
        logQc(line.id, {
          result,
          checks,
          reason: reasonEl ? reasonEl.value : '',
          note: sheet.querySelector('[data-note]').value.trim(),
          photoIds: shots,
        });
        haptic(10);
        toast(pass ? 'Passed — moved to Shipping' : 'Back to production');
        handle.close();
        if (onDone) onDone();
      });
    },
  });
}

function reworkRow(it) {
  const person = subs.subOfItem(it);
  return `
    <article class="prow" data-item="${esc(it.id)}" tabindex="0" role="button">
      <span class="prow-txt">
        <span class="prow-t">${esc(it.name || 'Untitled piece')}</span>
        <span class="prow-s">${esc(it.mrNo)}${person ? ` · ${esc(person.name)}` : ''}${it.trade ? ` · ${esc(subs.TRADE_LABELS[it.trade] || it.trade)}` : ''}</span>
      </span>
      ${stateChip(it)}
    </article>`;
}

/* ── The photograph library ────────────────────────────────────
   Every picture shot on the floor, filed under the project it
   belongs to — which is the MR number, the same code the quotation,
   the job and the work orders all use. Pictures live in IndexedDB;
   this only lays out the frames and fills them in once they are read
   back, so the screen never waits on the disk.

   Projects with no pictures are still listed. An empty project with
   a camera button on it is how pictures get taken. */

function photosHTML() {
  const groups = orderGroups({ q: query });
  return `
    ${searchBar(query, 'Search project, client')}

    ${sectionHead('By project')}
    ${groups.length ? groups.map((g) => `
      <div class="galgroup" data-gal="${esc(g.mrNo)}">
        <div class="galhead">
          <span class="galhead-txt">
            <span class="galhead-t">${esc(g.mrNo)}${g.client ? ` · ${esc(g.client)}` : ''}</span>
            <span class="galhead-s" data-count="${esc(g.mrNo)}">—</span>
          </span>
          <button class="mini" data-shoot-mr="${esc(g.mrNo)}">${icon('camera', 13)} Add</button>
        </div>
        <div class="galgrid" data-grid="${esc(g.mrNo)}"></div>
      </div>`).join('')
      : nothingHere('camera', query ? 'No project matches' : 'No projects yet',
          query ? 'Try another search' : 'Photographs are filed under the project they belong to')}`;
}

async function paintGallery(root) {
  let all = [];
  try { all = await photos.all(); } catch (e) { return; }
  const shots = all.filter((p) => p.status === 'shot');
  for (const host of root.querySelectorAll('[data-grid]')) {
    const mrNo = host.dataset.grid;
    const mine = shots
      .filter((p) => (p.mrNo || '').toUpperCase() === mrNo.toUpperCase())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const count = root.querySelector(`[data-count="${CSS.escape(mrNo)}"]`);
    if (count) {
      count.textContent = mine.length
        ? `${mine.length} photograph${mine.length === 1 ? '' : 's'}`
        : 'No photographs yet';
    }
    host.innerHTML = mine.map((p) => `<img class="galshot" src="${esc(blobURL(p))}" alt="">`).join('');
  }
}

/** Photographs filed straight against a project, with no piece in
    the middle — a site shot, a packed crate, a delivery. */
async function shootForProject(mrNo) {
  const files = await pickImage({ camera: true, multiple: true });
  if (!files.length) return 0;
  for (const f of files) {
    const { blob, w, h } = await shrink(f);
    await photos.put({
      id: uid('p'),
      entryId: `project:${mrNo}`,
      mrNo,
      blob,
      mime: 'image/jpeg',
      name: f.name || 'project.jpg',
      w, h,
      bytes: blob.size,
      status: 'shot',
      driveId: '', driveLink: '', extracted: null, error: '',
      createdAt: Date.now(),
    });
  }
  return files.length;
}

/* ── The catalog ───────────────────────────────────────────────
   The same design library as before, in the floor's own dressing.
   A design is a thing you make more than once; catalogued once, it
   is one tap in every future quotation. */

function catalogHTML(all) {
  const list = designs({ category: cat, q: query });
  const cats = ['All', ...CATEGORIES.filter((c) => all.some((d) => d.category === c))];

  return `
    ${statCards([
      { label: 'Designs', value: all.length, tone: 'quote' },
      { label: 'Categories', value: Math.max(0, cats.length - 1), hint: 'in use' },
      { label: 'Photographed', value: all.filter((d) => d.photo).length, hint: 'of ' + all.length },
    ])}

    ${searchBar(query, 'Search code, name, description')}

    ${cats.length > 1 ? `<div class="chipbar">
      ${cats.map((c) => `<button class="chip ${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>` : ''}

    ${list.length ? `<div class="dgrid">${list.map(designCard).join('')}</div>`
      : nothingHere('box',
          query || cat !== 'All' ? 'Nothing matches' : 'The catalog is empty',
          query || cat !== 'All' ? 'Try another category' : 'Add a design and it becomes one tap in every future quotation')}`;
}

function designCard(d) {
  return `
    <button class="dcard reveal" data-editdesign="${esc(d.code)}">
      ${d.photo ? `<img class="dcard-img" src="${esc(d.photo)}" alt="">`
                : `<span class="dcard-img ph">${icon('box', 26)}</span>`}
      <div class="dcard-body">
        <div class="dcard-code">${esc(d.code)}</div>
        <div class="dcard-name">${esc(d.name || '—')}</div>
        ${d.dims ? `<div class="dcard-dims">${esc(d.dims)}</div>` : ''}
        <div class="dcard-foot">
          <span class="dcard-rate num">${inr(d.unitPrice)}</span>
          <span class="pill mut">${esc(d.category)}</span>
        </div>
      </div>
    </button>`;
}
