/* app.js — boot, PIN gate, routing, tab bar. */

import { icon } from './icons.js';
import { $, on, toast, closeTopSheet, sheetCount, haptic, bindZoom } from './ui.js';
import { biometricEnabled, verifyBiometric } from './biometric.js';
import { load, hasPin, checkPin, device, onChange, purgeCashData } from './store.js';
import { openEntrySheet } from './views/entry.js';
import * as dashboard from './views/dashboard.js';
import * as home from './views/home.js';
import * as ledger from './views/ledger.js';
import * as jobs from './views/jobs.js';
import * as reports from './views/reports.js';
import * as quotes from './views/quotelist.js';
import * as library from './views/library.js';
import * as commission from './views/commission.js';
import { load as loadCommissions, purgeCashCommissions } from './commissions.js';
import { load as loadSubs } from './subs.js';
import * as inproduction from './views/production.js';
import * as subcontractor from './views/subcontractor.js';
import * as qc from './views/qc.js';
import * as shipping from './views/shipping.js';
import * as archive from './views/archive.js';
import { load as loadOrders } from './orders.js';
import { openNewOrder } from './views/production.js';
import { openDesignSheet } from './views/library.js';
import { openQuoteSheet } from './views/quotebuilder.js';
import { openSettings } from './views/settings.js';
import { syncPending, watchConnection, canUpload, online } from './sync.js';
import { enhance, bindHeroScroll, attachRipple } from './motion.js';
import { cloudConfigured } from './config.js';
import { signedIn, currentOrgId, ensureValidOrg } from './auth.js';
import { startSync, resetSyncState } from './cloud.js';
import { startQuoteSync, resetQuoteSync } from './quotesync.js';
import { startShopSync, resetShopSync } from './shopsync.js';
import { load as loadQuotes, onChange as onQuotesChange, fixHashtagNumbers, attachImportedPhotos } from './quotes.js';
import { markHTML, hasLogo } from './brand.js';
import { openSignIn, openChooseOrg } from './views/signin.js';
import { loadArchive } from './subphoto.js';

/* ── Nav ───────────────────────────────────────────────────────
   Kontour is the production unit, and the rail is the line itself,
   in the order work actually moves along it: a quotation is
   written, approved into production, farmed out to whoever makes
   it, checked, shipped, and filed. Reading the sidebar top to
   bottom is reading the floor from one end to the other.

   Phynance and Commission are not stations on that line — they are
   what the line costs and earns — so they sit under their own
   heading rather than in the middle of the sequence. */

const NAV = [
  {
    group: 'Production',
    items: [
      { route: 'dashboard',     label: 'Dashboard',      icon: 'home' },
      { route: 'quotes',        label: 'Quotation',      icon: 'note' },
      { route: 'inproduction',  label: 'In production',  icon: 'anvil' },
      { route: 'subcontractor', label: 'Sub-Contractor', icon: 'hands' },
      { route: 'qc',            label: 'QC + Catalog',   icon: 'clipboard' },
      { route: 'shipping',      label: 'Shipping',       icon: 'truck' },
      { route: 'archive',       label: 'Archive',        icon: 'archive' },
    ],
  },
  {
    group: 'Accounts',
    items: [
      { route: 'home',       label: 'Phynance',   icon: 'ledger' },
      { route: 'commission', label: 'Commission', icon: 'percent' },
    ],
  },
];

/* Phynance is the one destination that is really four screens, so
   it keeps the pill row it always had. Every station on the line is
   a single screen and needs none. */
const SUBNAV = {
  phynance: [
    { route: 'home', label: 'Overview' },
    { route: 'ledger', label: 'Ledger' },
    { route: 'jobs', label: 'Jobs' },
    { route: 'reports', label: 'Reports' },
  ],
};

const VIEWS = {
  dashboard, home, ledger, jobs, reports, quotes, library, commission,
  inproduction, subcontractor, qc, shipping, archive,
};

/* One primary action per screen, in one place. Every screen that can
   make something used to hide its own "+" in the top-right corner of
   the hero — the furthest point on a phone from the thumb holding it,
   and a different shape on every screen. They all share the floating
   button instead, and it says what it makes. The Dashboard reports
   rather than creates, so it has none and the button steps aside. */
const PRIMARY = {
  home:    { label: 'New entry', run: (ctx) => openEntrySheet({ onSaved: ctx.refresh }) },
  ledger:  { label: 'New entry', run: (ctx) => openEntrySheet({ onSaved: ctx.refresh }) },
  jobs:    { label: 'New entry', run: (ctx) => openEntrySheet({ onSaved: ctx.refresh }) },
  reports: { label: 'New entry', run: (ctx) => openEntrySheet({ onSaved: ctx.refresh }) },
  quotes:  { label: 'New quotation', run: (ctx) => openQuoteSheet({ onSaved: ctx.refresh }) },
  qc:      { label: 'Add design', run: (ctx) => openDesignSheet({ onSaved: ctx.refresh }) },
  library: { label: 'Add design', run: (ctx) => openDesignSheet({ onSaved: ctx.refresh }) },
  inproduction: { label: 'New piece', run: (ctx) => openNewOrder(ctx) },
  // Commission has its own + in the hero, next to the title, the way
  // Jobs does — a partner is added far less often than an entry, so
  // it does not need the thumb's own floating button.
};

/* Which module a screen belongs to. Only Phynance is a module of
   several screens now; every station on the line is its own
   destination, so its section is simply itself. */
const SECTION_OF = {
  home: 'phynance', ledger: 'phynance', jobs: 'phynance', reports: 'phynance',
  library: 'qc',   // the catalog opens under QC + Catalog
};

function sectionOf(where) {
  return SECTION_OF[where] || where;
}

/* Which half of the line a section belongs to — the two destinations
   a phone gets at the thumb instead of the rail. Built off NAV so the
   two never drift apart. sectionOf() names Phynance's screens
   "phynance" rather than the "home" its own nav row uses, so that
   alias rides along the same way the sidebar's own highlighting
   already special-cases it. */
const GROUP_OF = {};
NAV.forEach((g) => g.items.forEach((it) => {
  GROUP_OF[it.route] = g.group === 'Production' ? 'production' : 'accounts';
}));
GROUP_OF.phynance = GROUP_OF.home;

function groupOf(where) {
  return GROUP_OF[sectionOf(where)] || 'production';
}

let route = 'dashboard';
// Re-entering a module from the rail returns you to the screen you
// were last on in it, the way switching apps does.
let lastInSection = { phynance: 'home' };
// Same idea, one level up: which screen a tap on "Production" or
// "Accounts" lands on, on a phone.
let lastInGroup = { production: 'dashboard', accounts: 'phynance' };
let painting = false;
let detachScroll = null;   // hero↔topbar binding for the live screen
let revealIO = null;       // entrance observer for the live screen
let detachRows = null;     // chip-row overflow watch for the live screen

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
/* ── The shell's height ────────────────────────────────────────
   Only for a browser that cannot do `100dvh` at all — everything
   that can gets it straight from CSS (see styles.css) and this never
   runs. It has to stay that way: this file measured
   `visualViewport.height` on a real iPhone once and it came back
   shorter than the actual screen, permanently pinning the shell
   above the home indicator and reopening the exact dead strip this
   was written to close. dvh does not have that failure mode — it is
   the browser's own answer, not a second guess at it. */
function trackViewportHeight() {
  if (CSS.supports('height', '100dvh')) return;
  const vv = window.visualViewport;
  let last = 0;
  const apply = () => {
    const h = Math.round((vv && vv.height) || window.innerHeight || 0);
    // A toolbar sliding away reports dozens of intermediate heights.
    // Only a real change is worth a relayout of the whole shell.
    if (h > 0 && Math.abs(h - last) > 2) {
      last = h;
      document.documentElement.style.setProperty('--app-h', `${h}px`);
    }
  };
  apply();
  if (vv) {
    vv.addEventListener('resize', apply);
    // iOS reports the new height a beat after the rotation lands.
    window.addEventListener('orientationchange', () => setTimeout(apply, 260));
  } else {
    window.addEventListener('resize', apply, { passive: true });
  }
}

async function boot() {
  trackViewportHeight();
  const gate = $('#gate');
  // The PIN gate's markup ships in index.html, and the sign-in screen
  // paints over the same element. Held here so it can be put back.
  const pinMarkup = gate.innerHTML;

  if (cloudConfigured() && !(signedIn() && currentOrgId())) {
    gate.hidden = false;
    $('#app').hidden = true;
    await openSignIn(gate);
    gate.innerHTML = pinMarkup;
  } else if (cloudConfigured() && signedIn()) {
    // The books this device points at may no longer exist — two sets
    // merged into one leaves every device that was on the younger one
    // holding a dead id, and sync would answer "nothing here" forever
    // rather than fail. Checked once, briefly, and never allowed to
    // hold up an app whose first promise is that it opens with no
    // signal: an unreachable server leaves everything as it was.
    const check = await ensureValidOrg();
    if (check.switched) {
      // The cursors and the sent stamps describe the books that were
      // left behind, so they go with them.
      resetSyncState();
      resetQuoteSync();
      resetShopSync();

      // The local copies, though, stay. Books that merged took this
      // device's rows with them, so what is here belongs to the
      // surviving set — and clearing it, as an ordinary change of org
      // would, would take anything not yet pushed along with it.
      const [q, o, c, sb] = await Promise.all([
        import('./quotes.js'), import('./orders.js'), import('./commissions.js'), import('./subs.js'),
      ]);
      q.load(); o.load(); c.load(); sb.load();
      q.reclaim(check.switched.id);
      o.reclaim(check.switched.id);
      c.reclaim(check.switched.id);
      sb.reclaim(check.switched.id);
    } else if (!check.ok) {
      gate.hidden = false;
      $('#app').hidden = true;
      await openChooseOrg(gate);
      gate.innerHTML = pinMarkup;
    }
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

/* ── The sidebar ───────────────────────────────────────────────
   One dark column carrying the whole line, always in the same
   order, always in the same place. On a desktop it simply stands
   there; on a phone it slides in over the screen and closes the
   moment you pick something, because a phone has no room to keep
   a navigation column open beside the work.

   Built from NAV rather than written into index.html, so adding a
   station to the line is one line of data and nothing else. */
function buildSidebar() {
  const bar = $('#sidebar');

  bar.innerHTML = `
    <div class="side-brand">
      ${hasLogo() ? markHTML({ size: 30, className: 'side-mark', alt: '' })
        : `<img class="side-mark" src="assets/icon-192.png" alt="">`}
      <span class="side-word">KONTOUR</span>
      <button class="side-shut" data-nav-close aria-label="Close menu">${icon('close', 18)}</button>
    </div>

    <nav class="side-nav" aria-label="Sections">
      ${NAV.map((g) => `
        <p class="side-lbl">${g.group}</p>
        ${g.items.map((it) => `
          <button class="side-item" data-route="${it.route}">
            ${icon(it.icon, 19)}<span>${it.label}</span>
          </button>`).join('')}
      `).join('')}
    </nav>

    <div class="side-foot">
      <button class="side-item" data-settings>${icon('gear', 19)}<span>Settings</span></button>
    </div>`;

  on(bar, '[data-route]', (e, b) => {
    const r = b.dataset.route;
    show(lastInSection[r] || r);
    closeNav();
  });
  on(bar, '[data-settings]', () => { closeNav(); openSettings(ctx); });
  on(bar, '[data-nav-close]', closeNav);

  // The label rides along on every screen; only the wide button has
  // the room to show it, so on a phone it is the accessible name.
  $('#fab').innerHTML = `${icon('plus', 26, 2.2)}<span class="fab-t"></span>`;
  $('#fab').addEventListener('click', () => {
    const act = PRIMARY[route];
    if (!act) return;
    haptic(10);
    act.run(ctx);
  });

  on($('#brandbar'), '[data-nav-open]', openNav);
  $('#nav-scrim').addEventListener('click', closeNav);
}

function openNav() {
  document.body.classList.add('nav-open');
  haptic(6);
}

function closeNav() {
  document.body.classList.remove('nav-open');
}

/* ── The phone's tab bar ────────────────────────────────────────
   Two destinations, not seven: what is being made, and what it
   costs and earns. A tap remembers which screen you were last on in
   that half, the same way the rail's own rows do. Desktop never
   builds this — the rail already stands there. */
function buildTabbar() {
  const bar = $('#tabbar');
  if (!bar) return;
  bar.innerHTML = `
    <button class="tab" data-tabgroup="production">${icon('anvil', 22)}<span>Production</span></button>
    <button class="tab" data-tabgroup="accounts">${icon('wallet', 22)}<span>Accounts</span></button>
  `;
  on(bar, '[data-tabgroup]', (e, b) => {
    const g = b.dataset.tabgroup;
    const section = lastInGroup[g] || (g === 'production' ? 'dashboard' : 'phynance');
    show(lastInSection[section] || section);
  });
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
  on(nav, '.subtab', (e, b) => {
    // A subnav pill is a destination, not a filter toggle — landing on
    // it always shows that screen's plain top-level view, even if the
    // screen was left mid-filter (e.g. inside the Quotations Archive).
    if (b.dataset.route === 'quotes') quotes.resetView();
    show(b.dataset.route);
  });

  // After the hero, so the hero↔topbar handover still sees it first.
  const hero = screen.querySelector('.hero');
  if (hero) hero.after(nav);
  else screen.prepend(nav);

  // The pills are sized to fit a phone, but a long label or a large
  // text setting can still push the row past the edge. If it has,
  // bring the screen you are on into view rather than leaving it
  // cropped off the end.
  requestAnimationFrame(() => {
    if (nav.scrollWidth <= nav.clientWidth + 1) return;
    const on = nav.querySelector('.subtab.on');
    if (!on) return;
    // Set directly rather than scrollIntoView: this must land already
    // centred, not glide there in front of you as the screen appears.
    const prev = nav.style.scrollBehavior;
    nav.style.scrollBehavior = 'auto';
    nav.scrollLeft = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
    nav.style.scrollBehavior = prev;
  });
}

/* A horizontal filter row is only worth fading at its edge if it
   actually runs past it. Re-checked on resize, since a rotation can
   turn a row that overflowed into one that fits. */
function markScrollers(screen) {
  const rows = Array.from(screen.querySelectorAll('.chipbar'));
  if (!rows.length) return null;
  const mark = () => rows.forEach((r) => {
    r.classList.toggle('overflows', r.scrollWidth > r.clientWidth + 1);
  });
  requestAnimationFrame(mark);
  window.addEventListener('resize', mark, { passive: true });
  return () => window.removeEventListener('resize', mark);
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
    if (detachRows) { detachRows(); detachRows = null; }

    old.replaceWith(screen);

    const section = sectionOf(where);
    lastInSection[section] = where;
    // The floating button carries the live screen's one primary action,
    // and stands down on a screen that has none.
    const act = PRIMARY[where];
    const fab = $('#fab');
    fab.classList.toggle('off', !act);
    fab.setAttribute('aria-label', act ? act.label : '');
    fab.setAttribute('aria-hidden', act ? 'false' : 'true');
    fab.querySelector('.fab-t').textContent = act ? act.label : '';
    // The token layer keys off this: the shell is monochrome, and a
    // module re-points the whole ramp to its own colour.
    document.documentElement.dataset.section = section;
    buildSubnav(screen, where);
    $('#sidebar').querySelectorAll('[data-route]').forEach((b) => {
      const on_ = b.dataset.route === section
        || (section === 'phynance' && b.dataset.route === 'home');
      b.classList.toggle('on', on_);
      if (on_) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    const group = groupOf(where);
    lastInGroup[group] = section;
    $('#tabbar').querySelectorAll('[data-tabgroup]').forEach((b) => {
      b.classList.toggle('on', b.dataset.tabgroup === group);
    });
    if (location.hash !== `#/${where}`) history.replaceState(null, '', `#/${where}`);
    screen.scrollTop = Math.min(keepScroll, screen.scrollHeight);

    revealIO = enhance(screen, screen);
    detachScroll = bindHeroScroll(screen, $('#topbar'));
    detachRows = markScrollers(screen);
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
  loadCommissions();
  loadOrders();
  loadSubs();
  // The CA's call, not a preference: no cash account, no entry logged
  // against one. Runs every boot — cheap once there is nothing left to
  // remove — so it also catches a row pulled back down from a device
  // that has not yet updated.
  purgeCashData();
  purgeCashCommissions();
  fixHashtagNumbers();
  attachImportedPhotos();
  buildSidebar();
  buildTabbar();
  attachRipple($('#app'));

  // A phone has no rail beside the work, so it opens on Accounts —
  // that is where this app spends most of its mobile life. A desktop
  // keeps the rail and opens on the production floor as it always has.
  const mobile = !window.matchMedia('(min-width:900px)').matches;
  const defaultRoute = mobile ? 'home' : 'dashboard';
  const fromHash = (location.hash || '').replace('#/', '');
  show(VIEWS[fromHash] ? fromHash : defaultRoute);

  /* A thumbnail anywhere in the app — in a list, on a card, inside a
     sheet — opens its picture full screen. One handler on the
     document, because every screen draws thumbnails and none of them
     should have to wire a viewer. */
  bindZoom(document);

  /* The scanned photographs out of the original PDF quotations, so a
     piece whose quotation is not on this device still shows its
     picture. One fetch, cached, and it fails quietly offline. */
  loadArchive();

  // Back button closes a sheet before it leaves the app.
  window.addEventListener('popstate', () => {
    if (sheetCount()) {
      closeTopSheet();
      history.pushState(null, '', location.hash);
    }
  });
  history.pushState(null, '', location.hash || `#/${defaultRoute}`);

  // Redraw when the data changes underneath us (import, settings, seed).
  let queued = null;
  onChange(() => {
    clearTimeout(queued);
    queued = setTimeout(() => { if (!sheetCount()) show(route); }, 60);
  });

  onQuotesChange(() => {
    // An uploaded mark can land after the sidebar was drawn, so the
    // brand block is repainted rather than left showing the default.
    const mark = $('#sidebar').querySelector('.side-mark');
    if (mark && hasLogo()) {
      mark.outerHTML = markHTML({ size: 30, className: 'side-mark', alt: '' });
    }
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
    // Quotations ride their own sync on the same rhythm — separate
    // store, separate outbox, same books and the same row-level rules.
    startQuoteSync({
      onChange(r) {
        if (r.pulled && !sheetCount()) show(route);
      },
    });
    // The production line and the commission book, on the same rhythm.
    // Without this the two screens the workshop actually lives on were
    // device-local: what was logged on the phone stayed on the phone.
    startShopSync({
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
