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
  myOrgs, createOrg, setCurrentOrg, currentUser,
} from '../auth.js';
import { adoptLocalData } from '../cloud.js';
import { entries } from '../store.js';

let mode = 'in';        // 'in' | 'up' | 'forgot'

/**
 * Runs the whole sign-in flow and resolves once there is a session and
 * an org selected. The caller then starts the app.
 */
export function openSignIn(root) {
  return new Promise((resolve) => {
    paint(root, resolve);
  });
}

function shell(inner) {
  return `
    <div class="gate-inner auth">
      <div class="gate-mark">₹</div>
      <h1 class="gate-title">Phynance</h1>
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
  if (orgs.length === 0) return nameBooks(root, done);

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

/** First person in: there are no books yet, so name them. */
function nameBooks(root, done) {
  root.innerHTML = shell(`
    <p class="gate-sub">Name your books to finish setting up</p>
    <form class="auth-form" novalidate>
      <label class="auth-f">
        <span>Business name</span>
        <input class="control dark" name="name" value="Banavat India" required>
      </label>
      <div class="auth-err" data-err hidden></div>
      <button class="btn" type="submit">Create books</button>
    </form>
    <div class="auth-alt"><button data-out>Sign out</button></div>`);

  const form = root.querySelector('form');
  const errBox = root.querySelector('[data-err]');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      const org = await createOrg(new FormData(form).get('name'));
      await enter({ id: org.id, name: org.name, role: 'owner' }, done, { fresh: true });
    } catch (e) {
      errBox.textContent = friendly(e);
      errBox.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Create books';
    }
  });

  root.querySelector('[data-out]').addEventListener('click', async () => {
    await signOut(); mode = 'in'; paint(root, done);
  });
}

async function enter(org, done, { fresh = false } = {}) {
  if (!org) return;
  setCurrentOrg(org.id);

  // Books that already existed on this device before there was anywhere
  // to send them. Signing in should carry them up, not strand them.
  if (fresh && entries().length) {
    try {
      await adoptLocalData();
      toast('Your existing entries have been uploaded');
    } catch {
      // Not fatal — the outbox keeps them and the next sync retries.
      toast('Signed in. Your entries will upload shortly', 'warn');
    }
  }

  done(org);
}
