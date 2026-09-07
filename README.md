# Kontour — Banavat India

A daily money log. Every rupee that moves through Banavat India gets one entry:
what it was, which job it belonged to, which account it came from or went into,
and — if you photograph the bill — the bill itself.

Offline-first. Everything lives on the device it was logged on. Nothing is sent
anywhere unless you set up Google Drive and an API key yourself.

---

## Opening it

**https://kontour.banavat-india.com** — on any device, with nothing running at
your end. Chrome menu → **Add to Home Screen** and it launches full screen, like
an app.

Because it is served over HTTPS, the service worker registers: after the first
visit the app files are cached on the device and it opens with no internet at
all.

### Running it locally instead

For development, from a terminal in this folder:

```bash
python -m http.server 8792 --bind 0.0.0.0
```

Then http://localhost:8792. Note that over a plain LAN address like
`http://192.168.1.5:8792` browsers refuse to register a service worker — only
`https://` and `localhost` qualify — so offline caching is a subdomain-only
feature. That is why the hosted address above is the one to use on a phone.

### Data is still per-device

Nothing syncs between devices yet. An entry logged on the phone is not on the PC
and vice versa — the subdomain serves the *app*, not a shared ledger. Use
**Settings → Backup & restore** to move a ledger between them. See
[When it goes online](#when-it-goes-online) for what a shared ledger would take.

---

## The daily loop

Tap **+** → type the amount → **Money in / Money out / Transfer** → tap a
category → **Save**. Four taps and a number.

Everything else is behind **More details**, collapsed until you want it:

| Field | Notes |
|---|---|
| Date | Defaults to today |
| Job / MR No. | Optional. Type `B121` and the job is created. Codes you have used appear as chips |
| Party | Client, subcontractor or shop. Learns from what you have typed before |
| Particulars | What it was for |
| GST | Off by default. Turn on → pick a rate → say whether the amount you typed is *before GST* or *GST inside* |
| Bill photo | Camera or gallery. Also reachable from the camera icon in the header |

**Accounts are also the payment mode.** Bank and UPI — no Cash account, on the
CA's instruction to keep cash transactions out of the books entirely — so
choosing where the money came from is the same action as recording how it was
paid. Add more accounts in Settings.

---

## What it tracks

**Live balances.** Opening balance plus everything that has moved. Transfers
between your own accounts move money without counting as income or expense.

**GST both ways.** Collected on sales and paid on purchases, kept separate, with
a net figure at the bottom of Reports. That is data for your CA to file from —
Kontour does not file anything.

**Jobs.** Any entry can carry a job code. Give a job its order value and the
outstanding figure keeps itself current — the same Total / Paid / Remaining
shape as the income sheet, minus the manual arithmetic. Leave the order value
blank and the job simply shows no target.

**Recurring.** Rent, salaries, anything monthly. On the due day Home shows a
prompt with the figures filled in. Nothing is ever written to the ledger until
you tap save.

**Edits.** Free to change for 24 hours. After that an edit still works but
leaves a trail, so a number in the books never quietly moves.

**Export.** CSV per month, a one-page month summary for the CA, the full
financial year, or everything. Plus a JSON backup that restores the whole ledger
on another device.

---

## Bill photo → Drive → auto-fill

Photograph a bill and it is stored on the device immediately, at any time, with
no internet. It shows as *waiting to upload*.

When you are online **and** have set it up in Settings:

1. The photo uploads to **your** Google Drive, into `Kontour/2026/08/`, named
   `B109_2026-08-19_45000.jpg`.
2. Claude reads the image and fills in amount, date, party, GST rate, and a
   one-line description.
3. **You check it and save.** Nothing from the read is stored until you do, and
   it never overwrites something you already typed.

Both halves are already written and wired. They stay dormant until credentials
exist, and the queue drains on its own when the connection comes back.

### Setting it up

**Google Drive** — Settings → Google Drive. You need an OAuth client ID from
Google Cloud Console → Credentials → *OAuth client ID* → *Web application*, with
this app's address in the allowed JavaScript origins. The scope requested is
`drive.file`: Kontour can only ever see files it created itself, never the rest
of your Drive.

**Claude** — Settings → Read bills with Claude. Paste an Anthropic API key.
Default model is `claude-opus-5`; a receipt read runs at low effort so it is
quick and cheap. Server-side fallback is enabled, so if a safety classifier ever
declines an image the same request re-runs on a fallback model rather than
failing.

⚠️ **Do not paste the API key into Settings now that the app is public.**
Anyone who opens `kontour.banavat-india.com` can read a key stored in the
browser. Use the **Server endpoint** field instead — `server/` holds a
ready-to-deploy Cloudflare Worker that keeps the key server-side, and
[`server/README.md`](server/README.md) is the three-command setup. With an
endpoint set the app never sends a key at all.

---

## Security, honestly

- The **PIN** stops someone picking up your phone and reading the ledger. It is
  not encryption — the data on disk is not scrambled. Treat the phone's own lock
  screen as the real protection.
- The PIN and API key are **deliberately excluded from backups**, so restoring on
  another device never carries credentials across.
- **Erase everything** in Settings → About wipes the device, twice-confirmed.

---

## Files

```
index.html              app shell — PIN gate, screen, tab bar
manifest.webmanifest    home-screen install
sw.js                   offline cache (only active on https/localhost)
CNAME                   the subdomain, for GitHub Pages
server/                 Cloudflare Worker holding the Anthropic key
css/styles.css          the whole theme, tokens at the top
js/
  app.js                boot, PIN gate, routing
  store.js              the ledger — data model, balances, GST maths, totals
  db.js                 IndexedDB, photo blobs only
  format.js             ₹ Indian grouping, DD/MM/YYYY, FY Apr–Mar
  photos.js             capture, downscale, store
  sync.js               Google Drive upload + Claude bill reading
  export.js             CSV, backup, restore
  icons.js  ui.js       line icons, sheets, toasts
  motion.js             counters, reveals, ripple, hero↔topbar handover
  views/
    home.js             today, balances, jobs, this month
    entry.js            the add/edit sheet — the screen that matters
    ledger.js           every entry, grouped by day, filtered
    jobs.js             per-job money and outstanding
    reports.js          month summary, GST, exports
    settings.js         accounts, categories, recurring, PIN, credentials, backup
```

---

## When it goes online

Two of the three things this section used to list are done: the app is served
over HTTPS, so the service worker and PWA install work, and the API key has a
server-side home in `server/`.

What remains is a **shared ledger**. `store.js` is written as an async API over
one `read()` / `write()` pair backed by localStorage. Swapping that pair for API
calls is the whole migration — no view needs touching. The data shape already
carries everything a server would need: stable ids, timestamps, edit history,
and a job code on every entry.

## How it is hosted

GitHub Pages, from `main`, via `.github/workflows/deploy.yml` — every push
redeploys. `CNAME` holds the subdomain; a DNS `CNAME` record points `kontour`
at `studionexify.github.io`.

Worth knowing: `sw.js` is network-first, so a deploy reaches the phone on the
next online open rather than needing site data cleared.

---

## Theme

| Role | Colour | Where it lands |
|---|---|---|
| **Beige** `#FFF7E6` | canvas | Every page, the entry tray, the sheet background. Warm, not clinical white |
| **Emerald Pine** `#084734` | primary surface | Top of the hero gradient, selected chips and account cards, icon fills |
| **Pine** `#00311F` | deep structure | Bottom of every gradient, all body text, toasts |
| **Lime Glow** `#CEF17B` | the one accent | FAB, save button, active toggle, the amount rule, money-in figures on pine |
| **Green Tea** `#CDEDB3` | soft tint | Wells and tracks — secondary buttons, meter backgrounds, keypad action keys |

Two working notes on how it is applied:

**The accent is deliberately scarce.** Lime appears on the FAB, the primary
button, the live indicator dot, and the one figure that matters on a screen —
nowhere else. Category chips and account cards select in pine instead. If lime
were used for every selected state it would stop meaning "this one".

**Clay `#A8502C` is the single colour outside the brand set.** A ledger has to
separate money in from money out at a glance, and a second green cannot do that.
Clay is the warm complement to Beige, so it belongs to the family rather than
fighting it. On the dark pine surfaces it lightens to `#EBAC84` to stay legible.

### Depth, glass and movement

Three rules keep the richer surface from costing legibility:

**Glass floats, it never carries text.** Frosted surfaces are only used for
chrome that passes *over* content — the top bar that appears once the hero
scrolls away, the tab bar that content slides under, and the sticky day
headings in the ledger. Every block of readable detail sits on an opaque card.

**Gradients give depth, not noise.** They run light-to-dark along one axis so
surfaces read as lit from above, and never travel far enough to change the
contrast under any text. The icon tiles are the clearest case: a gradient, a
hairline highlight on the top edge, a shade on the bottom, and a cast shadow
tinted with the tile's own colour. That combination is what reads as a solid
object — a bevel alone never does.

**Motion explains, it does not perform.** Blocks enter from just below where
they belong, staggered in reading order. Figures count up so a change registers
as a change. Meter bars grow from zero so the relative sizes land. Saving draws
a tick, because recording money is the one action worth an unambiguous yes.

All of it lives in `js/motion.js` and switches off completely under
`prefers-reduced-motion`. Every animation also degrades safely: figures paint
their true value synchronously *before* the count begins, meters use timers
rather than animation frames, and anything left unrevealed after 1.6s is simply
shown. If the app is backgrounded mid-load — where the browser stops delivering
animation frames entirely — you get a static, complete screen rather than a
blank one.

Scrolling got two specific fixes: day headings in the ledger are bounded by
their own group so each one hands over to the next instead of every heading in
the month piling up at the same point, and they sit below the glass bar rather
than behind it. Secondary lines — the ones carrying job codes and particulars —
went from 11.5px in the faintest ink to 12.5px in the mid tone.

Text contrast was checked, not eyeballed: body 13.5:1 on beige, muted labels
4.7:1, every on-pine tone between 4.9:1 and 10:1. All tokens live at the top of
`css/styles.css` — change them there and the whole app follows.
