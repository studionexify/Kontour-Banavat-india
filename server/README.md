# The bill-reading proxy

One file, one job: hold the Anthropic API key so the browser doesn't have to.

On a LAN address, a key in Settings was only ever exposed to your own phone.
On `kontour.banavat-india.com` anyone who opens the page can read it out of
the browser. This Worker closes that — the key sits in Cloudflare, and the app
calls the Worker instead of Anthropic directly.

## Deploy it

From this folder, once:

```bash
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY   # paste the key when prompted
npx wrangler deploy
```

That prints a URL like `https://kontour-read-bill.<your-subdomain>.workers.dev`.

## Point the app at it

In Kontour: **Settings → Read bills with Claude**

1. Paste the Worker URL into **Server endpoint**.
2. Leave **API key** blank — with an endpoint set, the app never sends a key.
3. Keep the feature enabled.

That's the whole switch. `sync.js` already branches on the endpoint being
present, so nothing in the app needs changing.

## What it does and doesn't allow

The Worker only accepts POSTs from an origin in `ALLOWED_ORIGINS`
(`wrangler.toml`), which is what keeps it from being an open Claude API paid
for by your key. It also rejects anything that isn't a single-message read and
caps `max_tokens`. Responses pass back untouched, so the app's own handling of
`stop_reason`, `usage` and the 401/429 cases still works.

If you later serve the app from another origin too, add it to
`ALLOWED_ORIGINS` and redeploy.
