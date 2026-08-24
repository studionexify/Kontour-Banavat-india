# Connecting Phynance

Everything in this guide is a one-time job. Until it is done the app
runs exactly as it did before — on the device, no account, no sync — so
nothing here has to be finished in one sitting.

Work through it in order. Each part depends on the one above it.

---

## 1. Supabase — the database and the accounts

1. Create a project at [supabase.com](https://supabase.com). Any region
   close to India (Mumbai, `ap-south-1`) keeps the app responsive.
2. Open **SQL Editor**, paste the whole of
   `supabase/migrations/0001_init.sql`, and run it. It creates the
   tables, the roles, the invite wiring and the sync function.
3. Open **Project Settings → API** and copy two values:
   - **Project URL**
   - **anon / public** key
4. Paste them into `js/config.js`:

   ```js
   export const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```

   Both are safe to commit. The anon key is designed to be public and
   can do nothing without a session — row level security is what guards
   the data, and it is in the migration you just ran.

5. Under **Authentication → Providers → Email**, decide whether to
   require email confirmation. On is safer; off is quicker for staff
   who may not have work email. The app handles both.

> **Do not** put the `service_role` key in `js/config.js` or anywhere
> else in the browser. It ignores row level security entirely. It
> belongs only in the Vercel environment variables below.

### The first account

The first person to sign up and create the books becomes their
**owner**. Everyone after that is invited by the owner and arrives as
**staff**.

| Role | Can do |
|---|---|
| `owner` | Everything, including managing people |
| `admin` | Everything except removing the owner |
| `staff` | Log, edit and delete entries |
| `viewer` | Read the books; every write is refused |

An invite works whether or not that person already has an account —
if they do, they get access immediately; if they do not, they get it
the moment they sign up with that email.

---

## 2. Google Drive — where the bills go

Bills stay in Drive rather than the database, so Supabase storage stays
empty and the photos live where the storage is already paid for. Only
the file id goes into the database.

Pick **one** of these two, depending on the Google account the folder
lives in.

### If the books use a normal Google account (including Gmail)

Files are owned by that account and count against its storage.

1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project and enable the **Google Drive API**.
2. **APIs & Services → Credentials → Create OAuth client ID → Web
   application**. Add `https://developers.google.com/oauthplayground` as
   a redirect URI. Copy the client ID and secret.
3. Go to the
   [OAuth Playground](https://developers.google.com/oauthplayground),
   open the gear icon, tick **Use your own OAuth credentials**, and
   paste them in.
4. Authorise the scope `https://www.googleapis.com/auth/drive`, sign in
   as the business Google account, and exchange the code for tokens.
   Copy the **refresh token**.
5. Create the folder in that account's Drive that bills should go into,
   and copy its ID out of the address bar.

You now have `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN` and `DRIVE_ROOT_FOLDER_ID`.

### If the books use Google Workspace

1. Create a **service account** in the same console and download its
   JSON key.
2. Create a **Shared Drive**, and add the service account's email as a
   **Content manager**.
3. Copy the Shared Drive's folder ID.

You now have `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` (the
`private_key` field from the JSON) and `DRIVE_ROOT_FOLDER_ID`.

> A service account has no Drive storage of its own. Pointing one at a
> folder in a *normal* Google account fails on quota at the first
> upload rather than at setup, which is why the two paths above are
> kept separate. If both are configured the refresh token is used,
> because it is the one that works everywhere.

---

## 3. Vercel — hosting and the API

1. Import the repository at [vercel.com](https://vercel.com). There is
   no build step; the defaults in `vercel.json` are correct.
2. Add these under **Settings → Environment Variables**:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Same project URL as above |
   | `SUPABASE_ANON_KEY` | Same anon key as above |
   | `SUPABASE_SERVICE_ROLE_KEY` | **Project Settings → API → service_role** |
   | `DRIVE_ROOT_FOLDER_ID` | The Drive folder from part 2 |
   | `ANTHROPIC_API_KEY` | Only if bill reading is wanted |
   | `ALLOWED_ORIGINS` | Leave unset while the app and API share a domain |

   Plus **either** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
   `GOOGLE_REFRESH_TOKEN`, **or** `GOOGLE_SERVICE_ACCOUNT_EMAIL` and
   `GOOGLE_PRIVATE_KEY`.

3. Deploy, and check it on the `*.vercel.app` URL before touching DNS.

### Moving the domain

`kontour.banavat-india.com` currently points at GitHub Pages. Once the
Vercel deployment is working:

1. Add the domain in **Vercel → Settings → Domains**.
2. Repoint the DNS `CNAME` record to the target Vercel gives you.
3. Delete `.github/workflows/deploy.yml` and `CNAME` from the
   repository, so two hosts are not fighting over the same domain.

Do those in that order. Repointing DNS first means downtime while the
certificate is issued.

---

## 4. Checks worth doing

- Sign up, create the books, and confirm entries appear in Supabase
  under **Table Editor → records**.
- Invite a second email, sign in as that person on another device, and
  confirm an entry logged on one appears on the other.
- Turn the phone to aeroplane mode, log an entry, turn it back on, and
  confirm it uploads on its own.
- Set someone to `viewer` and confirm saving is refused.

---

## What is not connected yet

Two things are deliberately still on the old path, and both work today:

- **Bill photos** still upload to each user's own Google Drive through
  Settings, as before. The shared-folder route (`/api/bill-upload`) is
  built and deployed but the app does not call it yet, so a photo one
  person uploads is not visible to another.
- **Managing people** has no screen. Invites, roles and removals work
  through the database (`invites` and `memberships` tables in the
  Supabase Table Editor) but there is nothing in Settings for them yet.

Neither blocks using the shared ledger.
