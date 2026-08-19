/* app.js — boot, PIN gate, routing, tab bar. */

import { icon } from './icons.js';
import { $, on, toast, closeTopSheet, sheetCount, haptic } from './ui.js';
import { load, hasPin, checkPin, device, onChange } from './store.js';
import { openEntrySheet } from './views/entry.js';
import * as home from './views/home.js';
import * as ledger from './views/ledger.js';
import * as jobs from './views/jobs.js';
import * as reports from './views/reports.js';
import { openSettings } from './views/settings.js';
import { syncPending, watchConnection, driveAuthed, online } from './sync.js';

const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'ledger', label: 'Ledger', icon: 'ledger' },
  { id: 'jobs', label: 'Jobs', icon: 'jobs' },
  { id: 'reports', label: 'Reports', icon: 'reports' },
];

const VIEWS = { home, ledger, jobs, reports };

let route = 'home';
let painting = false;

const ctx = {
  go(where, params) {
    if (params && where === 'ledger') ledger.setFilter({ ...params, type: 'all', q: '' });
    if (params && where === 'jobs' && params.code) {
      show('jobs').then(() => jobs.openJob(params.code, ctx));
      return;
    }
    show(where);
  },
  refresh() { return show(route); },
  openSettings() { openSettings(ctx); },
  openEntry(opts) { openEntrySheet({ ...opts, onSaved: ctx.refresh }); },
};

/* ── PIN gate ──────────────────────────────────────────────── */

function buildPad(root, onKey) {
  root.innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    .map((n) => `<button data-k="${n}">${n}</button>`)
    .join('') + `<button class="ghost" data-k="skip"></button>
      <button data-k="0">0</button>
      <button class="ghost" data-k="del">⌫</button>`;
  on(root, '[data-k]', (e, b) => onKey(b.dataset.k));
}

function startGate() {
  const gate = $('#gate');
  const app = $('#app');

  if (!hasPin() || device.get('skipPin')) {
    gate.hidden = true;
    app.hidden = false;
    return start();
  }

  gate.hidden = false;
  app.hidden = true;

  let buf = '';
  const dots = $('#pin-dots');
  const sub = $('#gate-sub');

  function paint() {
    Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i < buf.length));
  }

  buildPad($('#gate-pad'), async (k) => {
    if (k === 'skip') return;
    haptic(6);
    if (k === 'del') { buf = buf.slice(0, -1); paint(); return; }
    if (buf.length >= 4) return;
    buf += k;
    paint();
    if (buf.length === 4) {
      const ok = await checkPin(buf);
      if (ok) {
        gate.hidden = true;
        app.hidden = false;
        start();
      } else {
        dots.classList.add('shake');
        sub.textContent = 'Wrong PIN — try again';
        sub.classList.add('err');
        setTimeout(() => { dots.classList.remove('shake'); buf = ''; paint(); }, 420);
      }
    }
  });
  paint();
}

/* ── Shell ─────────────────────────────────────────────────── */

function buildTabs() {
  const bar = $('#tabbar');
  bar.querySelectorAll('.tab').forEach((btn) => {
    const t = TABS.find((x) => x.id === btn.dataset.route);
    btn.innerHTML = `${icon(t.icon, 21)}<span>${t.label}</span>`;
  });
  $('#fab').innerHTML = icon('plus', 26, 2);

  on(bar, '.tab', (e, b) => show(b.dataset.route));
  on(bar, '#fab', () => {
    haptic(10);
    openEntrySheet({ onSaved: ctx.refresh });
  });
}

async function show(where) {
  if (!VIEWS[where]) where = 'home';
  const sameView = route === where;
  route = where;
  if (painting) return;
  painting = true;
  try {
    const old = $('#screen');
    // Refreshing in place keeps your position; changing tab starts at the top.
    const keepScroll = sameView ? old.scrollTop : 0;

    // A fresh node every render. Views bind delegated listeners to their root,
    // so reusing one element would stack a new set of handlers on every
    // refresh and a single tap would fire all of them.
    const screen = document.createElement('main');
    screen.id = 'screen';
    screen.className = 'screen';
    screen.setAttribute('aria-live', 'polite');

    await VIEWS[where].render(screen, ctx);
    old.replaceWith(screen);

    $('#tabbar').querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.route === where));
    if (location.hash !== `#/${where}`) history.replaceState(null, '', `#/${where}`);
    screen.scrollTop = Math.min(keepScroll, screen.scrollHeight);
  } catch (e) {
    console.error('[phynance] view failed', e);
    toast('Something went wrong drawing that screen', 'err');
  } finally {
    painting = false;
  }
}

function start() {
  load();
  buildTabs();

  const fromHash = (location.hash || '').replace('#/', '');
  show(VIEWS[fromHash] ? fromHash : 'home');

  // Back button closes a sheet before it leaves the app.
  window.addEventListener('popstate', () => {
    if (sheetCount()) {
      closeTopSheet();
      history.pushState(null, '', location.hash);
    }
  });
  history.pushState(null, '', location.hash || '#/home');

  // Redraw when the data changes underneath us (import, settings, seed).
  let queued = null;
  onChange(() => {
    clearTimeout(queued);
    queued = setTimeout(() => { if (!sheetCount()) show(route); }, 60);
  });

  // Push anything waiting whenever the connection comes back.
  watchConnection(() => {
    if (online() && driveAuthed()) {
      syncPending().then((r) => {
        if (r && r.done) toast(`${r.done} bill${r.done > 1 ? 's' : ''} uploaded`);
      }).catch(() => {});
    }
  });
  if (online() && driveAuthed()) syncPending().catch(() => {});

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Only registers on a secure context (https or localhost); over a plain
    // LAN address the browser refuses, which is expected and harmless.
    // update() on every load so a changed sw.js takes effect immediately
    // rather than after the next restart.
    navigator.serviceWorker.register('sw.js')
      .then((reg) => reg.update())
      .catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', startGate);
