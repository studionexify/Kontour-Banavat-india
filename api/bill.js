/* GET /api/bill?orgId=…&fileId=… — a bill photo back out of Drive.
 *
 * Files in the business folder are not public, and should not be: a
 * Drive sharing link is a bearer token that never expires and cannot be
 * taken back once forwarded. So the bytes come back through here, behind
 * the same membership check as everything else.
 */

import { cors, bad, requireMember } from './_lib/auth.js';
import { driveConfigured, downloadFile } from './_lib/google.js';

export default async function handler(req, res) {
  if (!cors(req, res)) return bad(res, 403, 'Origin not allowed');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return bad(res, 405, 'GET only');
  if (!driveConfigured()) return bad(res, 500, 'Server is not connected to Google Drive');

  const { orgId, fileId } = req.query || {};

  const member = await requireMember(req, res, orgId);
  if (!member) return;

  if (!fileId) return bad(res, 400, 'No file asked for');

  try {
    const { mimeType, bytes } = await downloadFile(fileId);
    res.setHeader('content-type', mimeType);
    // Private, because the response is scoped to one member's session,
    // but immutable — a Drive file id always points at the same bytes.
    res.setHeader('cache-control', 'private, max-age=86400, immutable');
    return res.status(200).send(bytes);
  } catch (e) {
    if (e.status === 404) return bad(res, 404, 'That bill is no longer in Drive');
    return bad(res, 502, 'Could not fetch the bill from Drive');
  }
}
