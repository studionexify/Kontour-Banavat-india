/* Phynance bill-reading proxy — a Cloudflare Worker.
 *
 * Why this exists: on a public subdomain an API key in the browser is
 * readable by anyone who opens the page. Settings → Read bills with Claude
 * has a "Server endpoint" field for exactly this — point it here, leave the
 * key field blank, and the key lives in this Worker's secrets instead.
 *
 * The contract is deliberately thin. sync.js already builds a complete
 * Anthropic Messages API body; this adds the credentials and passes the
 * response straight back. See js/sync.js, readBill().
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_BETA = 'server-side-fallback-2026-07-01';

/* A bill photo is downscaled before it gets here, but a cap keeps a bad
 * request from spending tokens. Base64 inflates by ~4/3, hence the slack. */
const MAX_BODY = 8 * 1024 * 1024;

function cors(origin, allowed) {
  const h = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request, env) {
    /* Which origins may call this. Set ALLOWED_ORIGINS as a comma-separated
     * list in wrangler.toml; without it nothing but the default is let in. */
    const allowed = (env.ALLOWED_ORIGINS || 'https://kontour.banavat-india.com')
      .split(',').map((s) => s.trim()).filter(Boolean);

    const origin = request.headers.get('origin');
    const cc = cors(origin, allowed);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cc });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cc);

    /* An open proxy would let anyone spend the key. The origin check is what
     * stops that, so a request without a permitted one never reaches Anthropic. */
    if (!origin || !allowed.includes(origin)) {
      return json({ error: 'Origin not allowed' }, 403, cc);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Proxy is missing ANTHROPIC_API_KEY' }, 500, cc);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'Request too large' }, 413, cc);

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'Body must be JSON' }, 400, cc);
    }

    /* Only ever a single-turn read. Without this the endpoint is a general
     * purpose Claude API on someone else's bill. */
    if (!Array.isArray(body.messages) || body.messages.length !== 1) {
      return json({ error: 'Expected a single-message read request' }, 400, cc);
    }
    if (typeof body.max_tokens === 'number' && body.max_tokens > 4096) {
      body.max_tokens = 4096;
    }
    if (env.MODEL) body.model = env.MODEL;

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
          'anthropic-beta': ANTHROPIC_BETA,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return json({ error: 'Could not reach Anthropic' }, 502, cc);
    }

    /* Passed through as-is: sync.js reads stop_reason, content, usage and
     * model off this, and maps 401/429 to its own messages. The one thing
     * never forwarded is anything that could identify the key. */
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', ...cc },
    });
  },
};
