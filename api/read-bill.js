/* POST /api/read-bill — the bill-reading proxy, moved off Cloudflare.
 *
 * Same contract as server/worker.js, which this replaces now that the
 * app and its API deploy together: sync.js builds a complete Messages
 * API body, this adds the credentials and passes the response straight
 * back. The one change is the gate. The Worker could only check the
 * calling origin, which any script can spoof; here there is a Supabase
 * session to check instead, so spending the key requires being a member
 * of the books rather than merely being on the right page.
 */

import { cors, bad, requireMember } from './_lib/auth.js';
import { readWithGemini } from './_lib/gemini.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const config = { api: { bodyParser: { sizeLimit: '12mb' } } };

export default async function handler(req, res) {
  if (!cors(req, res)) return bad(res, 403, 'Origin not allowed');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'POST only');

  const body = req.body;
  if (!body || typeof body !== 'object') return bad(res, 400, 'Body must be JSON');

  const member = await requireMember(req, res, body.orgId, { write: true });
  if (!member) return;

  // This endpoint's own fields, not part of the Messages API.
  const provider = body.provider === 'gemini' ? 'gemini' : 'claude';
  delete body.orgId;
  delete body.provider;

  /* Only ever a single-turn read. Without this the endpoint is a general
     purpose Claude API on someone else's bill. */
  if (!Array.isArray(body.messages) || body.messages.length !== 1) {
    return bad(res, 400, 'Expected a single-message read request');
  }
  if (typeof body.max_tokens === 'number' && body.max_tokens > 4096) body.max_tokens = 4096;

  /* Gemini answers in the Messages API's shape, so everything past this
     point — including how the app reads the reply — is the same either
     way. See api/_lib/gemini.js. */
  if (provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) return bad(res, 500, 'Server is missing GEMINI_API_KEY');
    const out = await readWithGemini(body, process.env.GEMINI_API_KEY);
    return res.status(out.status).json(out.json);
  }

  if (!process.env.ANTHROPIC_API_KEY) return bad(res, 500, 'Server is missing ANTHROPIC_API_KEY');
  if (process.env.MODEL) body.model = process.env.MODEL;

  let upstream;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return bad(res, 502, 'Could not reach Anthropic');
  }

  /* Passed through as-is: sync.js reads stop_reason, content, usage and
     model off this, and maps 401/429 to its own messages. The one thing
     never forwarded is anything that could identify the key. */
  const text = await upstream.text();
  res.setHeader('content-type', 'application/json');
  return res.status(upstream.status).send(text);
}
