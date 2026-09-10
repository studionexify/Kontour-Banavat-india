/* views/signin.js — the door.
 *
 * Shown only when this copy is configured for the cloud and nobody is
 * signed in. It borrows the PIN gate's pine-and-lime treatment on
 * purpose: these are the two screens that stand in front of the books,
 * and they should read as the same door rather than two different ones.
 *
 * Three states, one screen: sign in, create an account, or name the
 * books when a first sign-in finds none.
 */

import { esc, toast } from '../ui.js';
import {
  signIn, signUp, sendPasswordReset, signOut,
  myOrgs, setCurrentOrg, currentUser, requestToJoin, myJoinRequest,
} from '../auth.js';
import { adoptLocalData, sync as syncLedger } from '../cloud.js';
import { adoptLocalQuotes } from '../quotesync.js';
import { adoptLocalShop } from '../shopsync.js';
import { entries } from '../store.js';
import { quotes as allQuotes, load as loadQuotes } from '../quotes.js';
import { lines as orderLines, load as loadOrders } from '../orders.js';
import { partners as commissionPartners, load as loadCommissions } from '../commissions.js';

let mode = 'in';        // 'in' | 'up' | 'forgot'

/* Which books this device has already offered its own work to. An
   upload only has to happen once per org: after that every change
   rides the ordinary sync. Kept per org id rather than as one flag
   because a device that joins a second set of books has never
   uploaded to those. */
const ADOPTED_KEY = 'kontour.adopted';

function adoptedOrgs() {
  try {
    const v = JSON.parse(localStorage.getItem(ADOPTED_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function markAdopted(orgId) {
  const all = adoptedOrgs();
  if (all.includes(orgId)) return;
  all.push(orgId);
  try { localStorage.setItem(ADOPTED_KEY, JSON.stringify(all)); } catch {}
}

/**
 * Runs the whole sign-in flow and resolves once there is a session and
 * an org selected. The caller then starts the app.
 */
export function openSignIn(root) {
  return new Promise((resolve) => {
    paint(root, resolve);
  });
}

/**
 * The books picker on its own, for a session that is already signed in
 * but pointing at books that are gone — after two sets were merged into
 * one, say. Asking for the password again to answer a question the
 * account can already answer would be theatre.
 */
export function openChooseOrg(root) {
  return new Promise((resolve) => {
    chooseOrg(root, resolve);
  });
}

function shell(inner) {
  return `
    <div class="gate-inner auth">
      <div class="gate-mark">₹</div>
      <h1 class="gate-title">Kontour</h1>
      ${inner}
    </div>`;
}

function paint(root, done) {
  const titles = {
    in: 'Sign in to Banavat India',
    up: 'Create your account',
    forgot: 'Reset your password',
  };

  root.innerHTML = shell(`
    <p class="gate-sub">${titles[mode]}</p>
    <form class="auth-form" novalidate>
      ${mode === 'up' ? `
        <label class="auth-f">
          <span>Your name</span>
          <input class="control dark" name="name" autocomplete="name" placeholder="Veer Chaudhary">
        </label>` : ''}

      <label class="auth-f">
        <span>Email</span>
        <input class="control dark" name="email" type="email" inputmode="email"
               autocomplete="username" placeholder="you@banavat-india.com" required>
      </label>

      ${mode !== 'forgot' ? `
        <label class="auth-f">
          <span>Password</span>
          <input class="control dark" name="password" type="password"
                 autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}"
                 placeholder="${mode === 'up' ? 'At least 8 characters' : ''}" required>
        </label>` : ''}

      <div class="auth-err" data-err hidden></div>
      <button class="btn" type="submit" data-go>
        ${mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
      </button>
    </form>

    <div class="auth-alt">
      ${mode === 'in' ? `
        <button data-mode="up">Create an account</button>
        <button data-mode="forgot">Forgot password</button>` : `
        <button data-mode="in">Back to sign in</button>`}
    </div>`);

  const form = root.querySelector('form');
  const errBox = root.querySelector('[data-err]');
  const button = root.querySelector('[data-go]');

  const fail = (msg) => {
    errBox.textContent = msg;
    errBox.hidden = false;
    button.disabled = false;
    button.textContent = mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link';
  };

  root.querySelectorAll('[data-mode]').forEach((b) => {
    b.addEventListener('click', () => { mode = b.dataset.mode; paint(root, done); });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errBox.hidden = true;

    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const name = String(data.get('name') || '').trim();

    if (!email) return fail('Enter your email address.');
    if (mode !== 'forgot' && password.length < 8) {
      return fail('Passwords are at least 8 characters.');
    }

    button.disabled = true;
    button.textContent = 'One moment…';

    try {
      if (mode === 'forgot') {
        await sendPasswordReset(email);
        mode = 'in';
        paint(root, done);
        toast('Check your email for the reset link');
        return;
      }

      if (mode === 'up') {
        const session = await signUp(email, password, name);
        if (!session) {
          // Email confirmation is on: there is no session to continue with.
          mode = 'in';
          paint(root, done);
          toast('Account created — confirm your email, then sign in');
          return;
        }
      } else {
        await signIn(email, password);
      }

      await chooseOrg(root, done);
    } catch (e) {
      fail(friendly(e));
    }
  });
}

/** GoTrue's wording is for developers; this screen is not. */
function friendly(e) {
  const m = (e && e.message ? e.message : '').toLowerCase();
  if (m.includes('invalid login')) return 'That email and password do not match.';
  if (m.includes('already registered')) return 'That email already has an account — sign in instead.';
  if (m.includes('email not confirmed')) return 'Confirm your email address first, then sign in.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many tries. Wait a minute and try again.';
  if (m.includes('failed to fetch') || m.includes('networkerror')) {
    return 'Could not reach the server. Check the connection and try again.';
  }
  return e && e.message ? e.message : 'That did not work. Try again.';
}

/* ── Picking the books ─────────────────────────────────────── */

async function chooseOrg(root, done) {
  let orgs = [];
  try {
    orgs = await myOrgs();
  } catch (e) {
    root.innerHTML = shell(`
      <p class="gate-sub err">Signed in, but the books would not load.</p>
      <div class="auth-err">${esc(friendly(e))}</div>
      <button class="btn" data-retry>Try again</button>
      <div class="auth-alt"><button data-out>Sign out</button></div>`);
    root.querySelector('[data-retry]').addEventListener('click', () => chooseOrg(root, done));
    root.querySelector('[data-out]').addEventListener('click', async () => {
      await signOut(); mode = 'in'; paint(root, done);
    });
    return;
  }

  if (orgs.length === 1) return enter(orgs[0], done);
  if (orgs.length === 0) return waitingRoom(root, done);

  const user = currentUser();
  root.innerHTML = shell(`
    <p class="gate-sub">Signed in as ${esc(user ? user.email : '')}</p>
    <p class="tray-lbl" style="color:var(--pine-200);text-align:left">Choose books</p>
    <div class="auth-orgs">
      ${orgs.map((o) => `
        <button class="auth-org" data-org="${esc(o.id)}">
          <span class="auth-org-n">${esc(o.name)}</span>
          <span class="auth-org-r">${esc(o.role)}</span>
        </button>`).join('')}
    </div>
    <div class="auth-alt"><button data-out>Sign out</button></div>`);

  root.querySelectorAll('[data-org]').forEach((b) => {
    b.addEventListener('click', () => enter(orgs.find((o) => o.id === b.dataset.org), done));
  });
  root.querySelector('[data-out]').addEventListener('click', async () => {
    await signOut(); mode = 'in'; paint(root, done);
  });
}

/**
 * No org yet and no invite waiting: this account has to ask, and an
 * owner or admin decides — see 0007_join_requests.sql. Three states
 * of the same screen: not yet asked, asked and waiting, or declined.
 * Nothing here ever hands out an org of one's own any more; that is
 * the whole point of closing this door the way 0005 had to reopen it.
 */
async function waitingRoom(root, done) {
  let existing = null;
  try {
    existing = await myJoinRequest();
  } catch {
    // Offline, or the request table could not be reached. Falls
    // through to the ask-to-join form, which will hit the same error
    // and say so, rather than showing a silent blank screen here.
  }

  if (existing && existing.status === 'pending') return waiting(root, done);
  if (existing && existing.status === 'rejected') return declined(root, done);
  return askToJoin(root, done);
}

function askToJoin(root, done) {
  const user = currentUser();
  root.innerHTML = shell(`
    <p class="gate-sub">Ask Banavat India for access</p>
    <form class="auth-form" novalidate>
      <label class="auth-f">
        <span>Your name</span>
        <input class="control dark" name="name" autocomplete="name" placeholder="Veer Chaudhary">
      </label>
      <div class="auth-err" data-err hidden></div>
      <button class="btn" type="submit">Request access</button>
    </form>
    <p class="qb-hint" style="color:var(--pine-200)">
      Signed in as ${esc(user ? user.email : '')}. An owner or admin
      has to approve this before you can see anything.
    </p>
    <div class="auth-alt"><button data-out>Sign out</button></div>`);

  const form = root.querySelector('form');
  const errBox = root.querySelector('[data-err]');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Asking…';
    try {
      await requestToJoin(new FormData(form).get('name'));
      await waiting(root, done);
    } catch (e) {
      errBox.textContent = friendly(e);
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Request access';
    }
  });

  root.querySelector('[data-out]').addEventListener('click', async () => {
    await signOut(); mode = 'in'; paint(root, done);
  });
}

function waiting(root, done) {
  root.innerHTML = shell(`
    <p class="gate-sub">Waiting for approval</p>
    <p class="qb-hint" style="color:var(--pine-200)">
      Banavat India has not decided on your request yet. There is
      nothing more to do here — check back later, or try again now.
    </p>
    <button class="btn" data-retry>Check again</button>
    <div class="auth-alt"><button data-out>Sign out</button></div>`);

  root.querySelector('[data-retry]').addEventListener('click', () => chooseOrg(root, done));
  root.querySelector('[data-out]').addEventListener('click', async () => {
    await signOut(); mode = 'in'; paint(root, done);
  });
}

function declined(root, done) {
  root.innerHTML = shell(`
    <p class="gate-sub err">Your request was declined</p>
    <p class="qb-hint" style="color:var(--pine-200)">
      If this is unexpected, ask Banavat India directly — an owner or
      admin can reconsider from Settings.
    </p>
    <div class="auth-alt"><button data-out>Sign out</button></div>`);

  root.querySelector('[data-out]').addEventListener('click', async () => {
    await signOut(); mode = 'in'; paint(root, done);
  });
}

async function enter(org, done) {
  if (!org) return;
  setCurrentOrg(org.id);

  // Two halves of the same promise, and both used to be missed.
  //
  // Up: work done on this device before it had anywhere to send it.
  // That is not only the case where the books are new — signing in on
  // a phone that has been used for months, into books a colleague
  // created, strands exactly the same records, and used to. So the
  // upload runs the first time this device enters any given books,
  // not only when it makes them. Each record keeps its own stamp, so
  // an older local copy loses to the books rather than overwriting a
  // colleague's newer edit.
  //
  // Down: everything already on the books. A first sync pulls it
  // anyway, but doing it here means the app opens on the real books
  // rather than on an empty screen that fills in a moment later —
  // which is what "nothing shows on a new device" looked like.
  const first = !adoptedOrgs().includes(org.id);

  // These stores are read straight off localStorage by app.js
  // later in boot; here they have not been loaded yet, and asking an
  // unloaded store what it holds would answer "nothing" and skip the
  // upload for exactly the device that needs it.
  loadQuotes();
  loadOrders();
  loadCommissions();

  const mine = {
    entries: entries().length,
    quotes: allQuotes().length,
    shop: orderLines().length + commissionPartners().length,
  };

  try {
    if (first && mine.entries) await adoptLocalData(); else await syncLedger({ settingsToo: true });
    if (first && mine.quotes) await adoptLocalQuotes(); else await syncQuotesDown();
    if (first && mine.shop) await adoptLocalShop(); else await syncShopDown();
    if (first && (mine.entries || mine.quotes || mine.shop)) {
      toast('Your existing records have been uploaded');
    }
  } catch {
    // Not fatal — every sync retries on its own schedule.
    toast('Signed in. Syncing will finish in the background', 'warn');
  }

  markAdopted(org.id);
  done(org);
}

/* Imported where they are used rather than at the top so the sign-in
   screen still paints on a build where a sync module fails to load. */
async function syncQuotesDown() {
  const { syncQuotes } = await import('../quotesync.js');
  return syncQuotes({ settingsToo: true });
}

async function syncShopDown() {
  const { syncShop } = await import('../shopsync.js');
  return syncShop();
}
