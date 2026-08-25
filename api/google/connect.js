/* GET /api/google/connect?secret=… — start the one-time Drive consent.
 *
 * This exists because the usual route to a refresh token is Google's
 * OAuth Playground, a developer tool wearing a lot of switches that is
 * easy to fall out of. Here the app asks for its own consent, on its
 * own domain, and hands back the token on the next screen.
 */

import { secretMatches, signState, redirectUri, setupBlocked } from '../_lib/setup.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/drive';

export default function handler(req, res) {
  const blocked = setupBlocked();
  if (blocked) return res.status(403).json({ error: blocked });

  if (!secretMatches(req.query.secret, process.env.SETUP_SECRET)) {
    return res.status(403).json({ error: 'Wrong setup secret' });
  }

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: SCOPE,
    // Both are needed. offline asks for a refresh token; consent forces
    // a fresh one even when this account has approved before, without
    // which a second run returns an access token only.
    access_type: 'offline',
    prompt: 'consent',
    state: signState(process.env.SETUP_SECRET),
  });

  res.writeHead(302, { location: `${AUTH_URL}?${params}` });
  res.end();
}
