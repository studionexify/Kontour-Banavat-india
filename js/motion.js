/* motion.js — the app's movement, in one place.
 *
 * Everything here is opt-out in a single place: if the device asks for
 * reduced motion, every function below still produces the final state,
 * just without the journey. Nothing is ever only visible mid-animation.
 *
 * All animation runs on transform/opacity so it stays on the compositor;
 * nothing here triggers layout while scrolling.
 */

import { num, inrShort } from './format.js';

const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mq.matches;

/* ── Number formatting for counters ────────────────────────── */

const FMT = {
  inr: (v) => `<span class="cur">₹</span>${num(Math.round(v))}`,
  short: (v) => {
    const s = inrShort(Math.abs(v));
    return `${v < 0 ? '−' : ''}<span class="cur">₹</span>${s.replace('₹', '')}`;
  },
  plain: (v) => String(num(Math.round(v))),
};

/* Fast at the start, long tail — the eye reads the magnitude almost at
   once and the last digits settle after. */
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Counts an element from 0 (or its previous value) to `data-count`.
 * Markup: <div data-count="53100" data-fmt="inr"></div>
 */
export function countUp(el, { dur = 850 } = {}) {
  const to = Number(el.dataset.count || 0);
  const fmt = FMT[el.dataset.fmt] || FMT.inr;
  const from = Number(el.dataset.countFrom || 0);

  // Paint the true value synchronously, before anything else. If the frame
  // loop never runs — backgrounded tab, throttled renderer, reduced motion —
  // the figure is still correct and on screen rather than blank. The first
  // rAF below rewinds it to the start value before the browser ever paints,
  // so there is no flash of the final number.
  el.innerHTML = fmt(to);
  el.dataset.countFrom = String(to);

  if (reduced() || !to || from === to) return;

  // Cancel any counter still running on this element from a prior render.
  if (el._raf) cancelAnimationFrame(el._raf);

  let t0 = null;
  const step = (now) => {
    if (t0 === null) t0 = now;
    const p = Math.min(1, (now - t0) / dur);
    const v = from + (to - from) * easeOutExpo(p);
    el.innerHTML = fmt(p >= 1 ? to : v);
    if (p < 1) el._raf = requestAnimationFrame(step);
    else el._raf = null;
  };
  el._raf = requestAnimationFrame(step);
}

export function runCounters(root) {
  root.querySelectorAll('[data-count]').forEach((el) => countUp(el));
}

/* ── Entrance ──────────────────────────────────────────────────
   Blocks reveal as they reach the viewport, staggered by their
   order on screen. Anything already in view when the screen paints
   animates immediately, so the first fold is never blank.        */

const RISE = '.card, .kpi, .strip, .meter, .list, .empty, .kpis, .switchrow';

export function revealIn(root, scroller) {
  const items = Array.from(root.querySelectorAll(RISE))
    // Skip anything nested inside another rising block — one animation
    // per visual object, never a card fading inside a fading list.
    .filter((el) => !el.parentElement.closest(RISE));

  if (reduced() || !items.length) {
    items.forEach((el) => el.classList.add('shown'));
    return null;
  }

  items.forEach((el) => el.setAttribute('data-rise', ''));

  const show = (el, i) => {
    el.style.transitionDelay = `${Math.min(i, 6) * 55}ms`;
    el.classList.add('shown');
    // will-change is expensive to leave on. Hand the hint back as soon as
    // the transition that needed it has finished.
    setTimeout(() => { el.style.willChange = 'auto'; el.style.transitionDelay = ''; }, 900);
  };

  if (!('IntersectionObserver' in window)) {
    items.forEach(show);
    return null;
  }

  // One observer for everything. Blocks already on screen arrive in the
  // first callback and stagger in reading order; the rest animate as they
  // are scrolled to. Deliberately not offsetTop-based — `.panel` and
  // `.card` are positioned, so offsetTop is measured from the wrong box.
  const io = new IntersectionObserver((entries) => {
    entries
      .filter((en) => en.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      .forEach((en, i) => {
        show(en.target, i);
        io.unobserve(en.target);
      });
  }, { root: scroller || null, rootMargin: '0px 0px -6% 0px', threshold: 0.02 });

  items.forEach((el) => io.observe(el));

  // Safety net. IntersectionObserver only delivers while the document is
  // being rendered; if the app is backgrounded during load, nothing would
  // ever be revealed and the screen would stay blank. Anything still hidden
  // after a beat is simply shown.
  setTimeout(() => {
    items.forEach((el) => {
      if (!el.classList.contains('shown')) { io.unobserve(el); show(el, 0); }
    });
  }, 1600);

  return io;
}

/* ── Meters ────────────────────────────────────────────────────
   Bars grow from zero so the relative sizes register as a change
   rather than as a static picture.                              */

export function growMeters(root) {
  const fills = root.querySelectorAll('.meter-fill[data-w]');
  if (!fills.length) return;
  if (reduced()) {
    fills.forEach((f) => { f.style.width = f.dataset.w + '%'; });
    return;
  }
  // A timer rather than rAF: timers still fire in a backgrounded tab, so
  // the bars always reach their real width even if no frame is ever drawn.
  // The delay is enough for the initial width:0 to have been computed, which
  // is what makes the CSS transition animate rather than snap.
  setTimeout(() => {
    fills.forEach((f, i) => {
      f.style.transitionDelay = `${Math.min(i, 8) * 60}ms`;
      f.style.width = f.dataset.w + '%';
    });
  }, 40);
}

/* ── Ripple ────────────────────────────────────────────────────
   Bound once at the app root. Confirms the tap landed on the thing
   the finger covered — useful on a phone where the finger hides it. */

const RIPPLES = '.row, .card, .cat, .chip, .acct, .numgrid button, .disclose-btn';

export function attachRipple(root) {
  root.addEventListener('pointerdown', (e) => {
    if (reduced()) return;
    const host = e.target.closest(RIPPLES);
    if (!host || !root.contains(host)) return;

    const r = host.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.1;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.width = dot.style.height = `${size}px`;
    dot.style.left = `${e.clientX - r.left - size / 2}px`;
    dot.style.top = `${e.clientY - r.top - size / 2}px`;

    const prevPos = getComputedStyle(host).position;
    if (prevPos === 'static') host.style.position = 'relative';
    host.appendChild(dot);
    setTimeout(() => dot.remove(), 620);
  }, { passive: true });
}

/* ── Save confirmation ─────────────────────────────────────────
   A drawn tick. It exists because saving money is the one action
   worth an unambiguous "yes, that is recorded".                  */

export function burst() {
  if (reduced()) return;
  const el = document.createElement('div');
  el.className = 'burst';
  el.innerHTML = `
    <div class="burst-disc">
      <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 25.5 20.5 33 35 16"/></svg>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .22s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 240);
  }, 620);
}

/* ── Hero ↔ top bar crossfade ──────────────────────────────────
   As the hero scrolls away its content lifts and fades, and the
   frosted bar takes over the title and headline figure. One rAF
   per frame, transform/opacity only.                             */

export function bindHeroScroll(scroller, topbar) {
  const hero = scroller.querySelector('.hero');
  const FADE = 96;            // px of scroll to complete the handover
  let ticking = false;
  let last = -1;

  const apply = () => {
    ticking = false;
    const y = scroller.scrollTop;
    const p = Math.max(0, Math.min(1, y / FADE));
    if (hero) hero.style.setProperty('--p', p.toFixed(3));

    // The glass bar exists to take over from a hero that has scrolled
    // away. A screen with no hero has nothing to hand over, so the bar
    // stays down rather than sliding in empty.
    const on = Boolean(hero) && y > FADE * 0.72;
    if (on !== (last === 1)) {
      topbar.classList.toggle('on', on);
      last = on ? 1 : 0;
    }
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  };

  scroller.addEventListener('scroll', onScroll, { passive: true });
  apply();
  return () => scroller.removeEventListener('scroll', onScroll);
}

/* ── One call per render ───────────────────────────────────────── */

export function enhance(root, scroller) {
  runCounters(root);
  growMeters(root);
  return revealIn(root, scroller);
}
