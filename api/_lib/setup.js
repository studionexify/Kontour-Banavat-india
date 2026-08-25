/* setup.js — the guards on the one-time Google connect routes.
 *
 * These two routes mint Drive credentials, so they are locked shut by
 * default and only open when SETUP_SECRET is deliberately set. Remove
 * that variable once Drive is connected and they close again.
 */

import crypto from 'node:crypto';

/** Constant-time compare that tolerates unequal lengths. */
export function secretMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** A nonce Google hands back, that only this deployment could mint. */
export function signState(secret, at = Date.now()) {
  const mac = crypto.createHmac('sha256', secret).update(String(at)).digest('hex').slice(0, 32);
  return `${at}.${mac}`;
}

export function checkState(secret, state) {
  const [at, mac] = String(state || '').split('.');
  if (!at || !mac) return false;
  if (!Number(at) || Date.now() - Number(at) > 10 * 60 * 1000) return false;
  return secretMatches(mac, signState(secret, Number(at)).split('.')[1]);
}

export function redirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/google/callback`;
}

/**
 * Shared preconditions. Returns an error string, or '' when the route
 * may proceed.
 */
export function setupBlocked() {
  if (!process.env.SETUP_SECRET) {
    return 'Set SETUP_SECRET in the Vercel environment to use this once, then remove it.';
  }
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    return 'Drive is already connected. Clear GOOGLE_REFRESH_TOKEN first if you need to reconnect.';
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.';
  }
  return '';
}

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The setup pages share the app's pine-and-lime treatment. */
export function page(title, bodyHtml) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Kontour</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 64px;
    background: linear-gradient(168deg, #084734 0%, #00281A 55%, #001A10 100%);
    color: #FFF7E6; min-height: 100vh;
    font: 16px/1.55 "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
  }
  main { max-width: 660px; margin: 0 auto; }
  h1 { font-size: 25px; margin: 0 0 6px; letter-spacing: -.2px; }
  h2 { font-size: 15px; margin: 30px 0 8px; color: #CEF17B; letter-spacing: .3px; }
  p { color: #B9D8C4; margin: 0 0 14px; }
  code, pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
  }
  pre {
    background: rgba(255,247,230,.07);
    border: 1px solid rgba(206,241,123,.24);
    border-radius: 14px; padding: 14px;
    overflow-x: auto; white-space: pre-wrap; word-break: break-all;
    color: #E2FAA6;
  }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 14px; }
  td { padding: 9px 10px; border-bottom: 1px solid rgba(255,247,230,.1); font-size: 14px; vertical-align: top; }
  td:first-child { color: #B9D8C4; white-space: nowrap; }
  .ok { color: #CEF17B; font-weight: 600; }
  .warn {
    background: rgba(235,172,132,.15); border: 1px solid #EBAC84;
    border-radius: 14px; padding: 13px 15px; color: #FFF7E6; margin: 18px 0;
  }
  a { color: #CEF17B; }
</style>
</head><body><main>${bodyHtml}</main></body></html>`;
}
