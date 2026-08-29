/* photos.js — capture a bill, shrink it, keep it on the device.
   Works fully offline: a file input with `capture` needs no camera
   permission API and no secure context, unlike getUserMedia. */

import { photos } from './db.js';
import { uid } from './store.js';
import { imageSrc } from './format.js';

const MAX_EDGE = 1600;     // plenty for a GST bill, small enough to store many
const QUALITY = 0.82;

/** Opens the camera / gallery and resolves with the chosen File(s). */
export function pickImage({ camera = true, multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    if (multiple) input.multiple = true;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    let settled = false;
    const finish = (files) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => finish(Array.from(input.files || [])));
    // If the picker is dismissed, `change` never fires — clean up on the
    // next focus so we do not leak inputs into the DOM.
    window.addEventListener('focus', () => setTimeout(() => finish([]), 800), { once: true });
    input.click();
  });
}

/** Downscales and re-encodes to JPEG so storage stays sane. */
export function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (!blob) { reject(new Error('Could not read that image.')); return; }
        resolve({ blob, w, h });
      }, 'image/jpeg', QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

/**
 * Saves a picked file against an entry (or with entryId '' while the entry
 * is still being typed) and marks it for upload.
 */
export async function attach(file, entryId = '') {
  const { blob, w, h } = await shrink(file);
  const rec = {
    id: uid('p'),
    entryId,
    blob,
    mime: 'image/jpeg',
    name: file.name || 'bill.jpg',
    w, h,
    bytes: blob.size,
    status: 'local',          // local → queued → uploaded (or failed)
    driveId: '',
    driveLink: '',
    extracted: null,
    error: '',
    createdAt: Date.now(),
  };
  await photos.put(rec);
  return rec;
}

/** Re-points photos captured before the entry existed. */
export async function bindToEntry(photoIds, entryId) {
  for (const id of photoIds) {
    await photos.patch(id, { entryId, status: 'queued' });
  }
}

export async function detach(id) {
  await photos.remove(id);
}

export function humanBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export async function toBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/* A picked file, ready to be written straight onto a record: shrunk,
   re-encoded, and carrying the data: prefix an <img> needs. The three
   pictures the app holds in a record rather than in the photo store —
   the logo, a design's photograph, a quotation line's image — all come
   through here, so none of them can be saved as something the browser
   will not draw. */
export async function toDataUrl(file) {
  const { blob } = await shrink(file);
  return imageSrc(await toBase64(blob));
}

export { photos, imageSrc };
