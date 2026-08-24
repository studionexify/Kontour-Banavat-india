/* POST /api/bill-upload — a bill photo into the business's Drive folder.
 *
 * The device sends base64 (it already holds the photo as a blob and has
 * downscaled it), and gets back a Drive file id. Only that id and the
 * link go into Supabase, so the database stays a ledger and the photos
 * stay in Drive where the storage is already paid for.
 *
 * Filed as <root>/<year>/<month>/, matching what the app used to write
 * from the device, so an existing folder keeps its shape.
 */

import { cors, bad, requireMember } from './_lib/auth.js';
import { driveConfigured, ensureFolder, uploadFile } from './_lib/google.js';

export const config = {
  api: {
    // Base64 inflates by about 4/3, and a downscaled bill lands well
    // under this. The cap is what stops a bad request costing a slot.
    bodyParser: { sizeLimit: '12mb' },
  },
};

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export default async function handler(req, res) {
  if (!cors(req, res)) return bad(res, 403, 'Origin not allowed');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'POST only');

  if (!driveConfigured()) return bad(res, 500, 'Server is not connected to Google Drive');
  if (!process.env.DRIVE_ROOT_FOLDER_ID) return bad(res, 500, 'Server is missing DRIVE_ROOT_FOLDER_ID');

  const { orgId, name, mimeType, dataBase64, date } = req.body || {};

  const member = await requireMember(req, res, orgId, { write: true });
  if (!member) return;

  if (!dataBase64) return bad(res, 400, 'No file sent');
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return bad(res, 400, 'Only JPEG, PNG, WebP or PDF bills can be uploaded');
  }

  let bytes;
  try {
    bytes = Buffer.from(dataBase64, 'base64');
  } catch {
    return bad(res, 400, 'File was not valid base64');
  }
  if (!bytes.length) return bad(res, 400, 'File was empty');

  // The entry's own date decides the folder, not today's — a bill logged
  // late still files under the month the money moved.
  const when = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : new Date().toISOString().slice(0, 10);
  const [year, month] = when.split('-');

  try {
    const yearId = await ensureFolder(year, process.env.DRIVE_ROOT_FOLDER_ID);
    const monthId = await ensureFolder(month, yearId);
    const out = await uploadFile({
      name: name || `bill-${when}.jpg`,
      mimeType,
      bytes,
      parentId: monthId,
    });
    return res.status(200).json({ driveId: out.id, driveLink: out.link });
  } catch (e) {
    // Drive's own message is the useful one here (quota, permission on
    // the folder), so it is passed through rather than flattened.
    const status = e.status === 403 || e.status === 404 ? 502 : 500;
    return bad(res, status, `Drive would not take the file — ${e.message}`);
  }
}
