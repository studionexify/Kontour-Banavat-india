/* app.js — boot, PIN gate, routing, tab bar. */

import { icon } from './icons.js';
import { $, on, toast, closeTopSheet, sheetCount, haptic } from './ui.js';
import { biometricEnabled, verifyBiometric } from './biometric.js';
import { load, hasPin, checkPin, device, onChange } from './store.js';
import { openEntrySheet } from './views/entry.js';
import * as dashboard from './views/dashboard.js';
import * as home from './views/home.js';
import * as ledger from './views/ledger.js';
import * as jobs from './views/jobs.js';
import * as reports from './views/reports.js';
import * as quotes from './views/quotelist.js';
import * as library from './views/library.js';
import { openSettings } from './views/settings.js';
import { syncPending, watchConnection, canUpload, online } from './sync.js';
import { enhance, bindHeroScroll, attachRipple } from './motion.js';
import { cloudConfigured } from './config.js';
import { signedIn, currentOrgId } from './auth.js';
import { startSync } from './cloud.js';
import { load as loadQuotes, onChange as onQuotesChange } from './quotes.js';
import { markHTML, hasLogo } from './brand.js';
import { openSignIn } from './views/signin.js';

/* ── Nav ───────────────────────────────────────────────────────
   Kontour is the workspace; Phynance is the money module inside
   it. So the rail carries destinations, not screens: Home, and
   the module. Ledger, Jobs and Reports are Phynance's own three
   screens, and they appear as a sub-nav once you are in it. */

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', route: 'dashboard' },
  { id: 'phynance', label: 'Phynance', icon: 'ledger', route: 'home' },
  { id: 'quotation', label: 'Quotation', icon: 'tag', route: 'quotes' },
];

const SUBNAV = {
  phynance: [
    { route: 'home', label: 'Overview' },
    { route: 'ledger', label: 'Ledger' },
    { route: 'jobs', label: 'Jobs' },
    { route: 'reports', label: 'Reports' },
  ],
  quotation: [
    { route: 'quotes', label: 'Quotations' },
    { route: 'library', label: 'Design library' },
  ],
};

const VIEWS = { dashboard, home, ledger, jobs, reports, quotes, library };

/* Which module a screen belongs to. The Dashboard is Kontour's
   own; money screens are Phynance's; quoting is its own module. */
const SECTION_OF = {
  dashboard: 'dashboard',
  home: 'phynance', ledger: 'phynance', jobs: 'phynance', reports: 'phynance',
  quotes: 'quotation', library: 'quotation',
};

function sectionOf(where) {
  return SECTION_OF[where] || 'dashboard';
}

let route = 'dashboard';
// Re-entering a module from the rail returns you to the screen you
// were last on in it, the way switching apps does.
let lastInSection = { dashboard: 'dashboard', phynance: 'home', quotation: 'quotes' };
let painting = false;
let detachScroll = null;   // hero↔topbar binding for the live screen
let revealIO = null;       // entrance observer for the live screen

const ctx = {
  go(where, params) {
    if (params && where === 'ledger') ledger.setFilter({ ...params, type: 'all', q: '' });
    if (params && where === 'quotes' && params.id) {
      show('quotes').then(() => quotes.openById(params.id, ctx));
      return;
    }
    if (params && where === 'jobs' && params.code) {
      show('jobs').then(() => jobs.openJob(params.code, ctx));
      return;
    }
    show(where);
  },
  refresh() { return show(route); },
  openSettings() { openSettings(ctx); },
  openEntry(opts) { openEntrySheet({ ...opts, onSaved: ctx.refresh }); },

  /** What the frosted bar shows once the hero has scrolled away. */
  setTopbar(title, value, label) {
    const t = $('#topbar');
    t.querySelector('[data-tb-t]').textContent = title || '';
    t.querySelector('[data-tb-v]').innerHTML = value
      ? `${value}${label ? `<small>${label}</small>` : ''}`
      : '';
  },
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

/* ── Boot ──────────────────────────────────────────────────────
   Two doors, in this order: the account, then the PIN. The account
   says which books these are; the PIN says this is still the person
   who was holding the phone. A copy with no cloud configured skips
   the first entirely and behaves exactly as it always has. */
async function boot() {
  const gate = $('#gate');
  // The PIN gate's markup ships in index.html, and the sign-in screen
  // paints over the same element. Held here so it can be put back.
  const pinMarkup = gate.innerHTML;

  if (cloudConfigured() && !(signedIn() && currentOrgId())) {
    gate.hidden = false;
    $('#app').hidden = true;
    await openSignIn(gate);
    gate.innerHTML = pinMarkup;
  }
  startGate();
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

  if (hasLogo()) {
    const glyph = gate.querySelector('.gate-mark');
    if (glyph) glyph.outerHTML = markHTML({ size: 64, className: 'gate-logo', alt: '' });
  }

  let buf = '';
  const dots = $('#pin-dots');
  const sub = $('#gate-sub');
  const bioBtn = $('#gate-bio');

  function paint() {
    Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i < buf.length));
  }

  function unlock() {
    gate.hidden = true;
    app.hidden = false;
    start();
  }

  // Face ID, a fingerprint, Windows Hello — whatever this device's own
  // lock screen already is. See js/biometric.js for why this needs no
  // server round trip: it is a faster door next to the PIN, not a
  // replacement for it, so a cancel or a failed scan just leaves the
  // PIN pad below exactly as if biometrics did not exist.
  const bioOn = biometricEnabled();
  bioBtn.hidden = !bioOn;
  if (bioOn) {
    bioBtn.innerHTML = `${icon('fingerprint', 18)}<span>Unlock with Face ID / fingerprint</span>`;
    bioBtn.onclick = tryBiometric;
  }

  async function tryBiometric({ auto = false } = {}) {
    if (!bioOn) return;
    if (!auto) sub.textContent = 'Waiting…';
    const ok = await verifyBiometric();
    if (ok) { haptic(10); unlock(); return; }
    sub.textContent = 'Enter your PIN';
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
        unlock();
      } else {
        dots.classList.add('shake');
        sub.textContent = 'Wrong PIN — try again';
        sub.classList.add('err');
        setTimeout(() => { dots.classList.remove('shake'); buf = ''; paint(); }, 420);
      }
    }
  });
  paint();

  // Prompted once, automatically, the moment the gate is shown — the
  // point of having this at all is not typing anything most times the
  // app opens. A dismiss or a failed scan is silent by design (see
  // verifyBiometric); the PIN pad is already sitting right there.
  if (bioOn) tryBiometric({ auto: true });
}

/* ── Shell ─────────────────────────────────────────────────── */

/* The rail wears the mark beside the name once one is uploaded; the
   CSS wordmark stands in until then, so the rail is never empty. */
function paintRailBrand() {
  const bar = $('#tabbar');
  bar.classList.toggle('has-logo', hasLogo());
  let brand = bar.querySelector('.rail-brand');
  if (!hasLogo()) { if (brand) brand.remove(); return; }
  if (!brand) {
    brand = document.createElement('div');
    brand.className = 'rail-brand';
    bar.prepend(brand);
  }
  brand.innerHTML = `${markHTML({ size: 30, alt: '' })}<span class="rail-brand-t">Kontour</span>`;
}

function buildTabs() {
  const bar = $('#tabbar');
  bar.querySelectorAll('.tab').forEach((btn) => {
    const t = NAV.find((x) => x.id === btn.dataset.nav);
    btn.innerHTML = `${icon(t.icon, 21)}<span>${t.label}</span>`;
  });
  $('#fab').innerHTML = icon('plus', 26, 2.2);

  on(bar, '.tab', (e, b) => {
    const id = b.dataset.nav;
    show(lastInSection[id] || NAV.find((x) => x.id === id).route);
  });
  on(bar, '#fab', () => {
    haptic(10);
    openEntrySheet({ onSaved: ctx.refresh });
  });
  paintRailBrand();
}

/* The module's own three screens, as a row of pills that sticks to
   the top of the scroller once the hero has gone by. Rebuilt with
   each render because the screen element is rebuilt with it. */
function buildSubnav(screen, where) {
  const items = SUBNAV[sectionOf(where)];
  if (!items) return;

  const nav = document.createElement('nav');
  nav.className = 'subnav';
  nav.setAttribute('aria-label', sectionOf(where));
  nav.innerHTML = items.map((it) => `
    <button class="subtab${it.route === where ? ' on' : ''}"
            data-route="${it.route}"
            ${it.route === where ? 'aria-current="page"' : ''}>${it.label}</button>
  `).join('');
  on(nav, '.subtab', (e, b) => show(b.dataset.route));

  // After the hero, so the hero↔topbar handover still sees it first.
  const hero = screen.querySelector('.hero');
  if (hero) hero.after(nav);
  else screen.prepend(nav);
}

async function show(where) {
  if (!VIEWS[where]) where = 'dashboard';
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

    ctx.setTopbar('', '');
    await VIEWS[where].render(screen, ctx);

    // Tear down the previous screen's observers before it is discarded.
    if (detachScroll) { detachScroll(); detachScroll = null; }
    if (revealIO) { revealIO.disconnect(); revealIO = null; }

    old.replaceWith(screen);

    const section = sectionOf(where);
    lastInSection[section] = where;
    // Logging an entry is Phynance's action, not the workspace's, so
    // the button belongs to Phynance's screens rather than the rail
    // it happens to sit in. Elsewhere the rail is navigation only.
    $('#tabbar').classList.toggle('no-fab', section !== 'phynance');
    // The token layer keys off this: the shell is monochrome, and a
    // module re-points the whole ramp to its own colour.
    document.documentElement.dataset.section = section;
    buildSubnav(screen, where);
    $('#tabbar').querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.nav === section));
    if (location.hash !== `#/${where}`) history.replaceState(null, '', `#/${where}`);
    screen.scrollTop = Math.min(keepScroll, screen.scrollHeight);

    revealIO = enhance(screen, screen);
    detachScroll = bindHeroScroll(screen, $('#topbar'));
  } catch (e) {
    console.error('[kontour] view failed', e);
    toast('Something went wrong drawing that screen', 'err');
  } finally {
    painting = false;
  }
}

function start() {
  load();
  loadQuotes();
  buildTabs();
  attachRipple($('#app'));

  const fromHash = (location.hash || '').replace('#/', '');
  show(VIEWS[fromHash] ? fromHash : 'dashboard');

  // Back button closes a sheet before it leaves the app.
  window.addEventListener('popstate', () => {
    if (sheetCount()) {
      closeTopSheet();
      history.pushState(null, '', location.hash);
    }
  });
  history.pushState(null, '', location.hash || '#/dashboard');

  // Redraw when the data changes underneath us (import, settings, seed).
  let queued = null;
  onChange(() => {
    clearTimeout(queued);
    queued = setTimeout(() => { if (!sheetCount()) show(route); }, 60);
  });

  onQuotesChange(() => {
    paintRailBrand();
    clearTimeout(queued);
    queued = setTimeout(() => { if (!sheetCount()) show(route); }, 60);
  });

  // Push anything waiting whenever the connection comes back.
  watchConnection(() => {
    if (online() && canUpload()) {
      syncPending().then((r) => {
        if (r && r.done) toast(`${r.done} bill${r.done > 1 ? 's' : ''} uploaded`);
      }).catch(() => {});
    }
  });
  if (online() && canUpload()) syncPending().catch(() => {});

  // The shared ledger. Redraws only when a pull actually moved something,
  // so a colleague logging an entry updates the screen you are looking at
  // without a sync that found nothing flickering it.
  if (cloudConfigured() && signedIn() && currentOrgId()) {
    startSync({
      onChange(r) {
        if (r.pulled && !sheetCount()) show(route);
      },
    });
  }

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

document.addEventListener('DOMContentLoaded', boot);
