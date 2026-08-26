/* biometric.js — Face ID, a fingerprint, Windows Hello, an Android
 * screen lock: whatever the device itself already uses to unlock.
 *
 * There is no such thing as a website reading a fingerprint or a face.
 * What actually exists — and what this file wraps — is WebAuthn's
 * platform authenticator: the browser hands the "prove it's you"
 * moment to the operating system, and the OS shows whatever it
 * already shows to unlock the device. On a phone that is usually a
 * face or a finger; on a laptop with no sensor it can fall back to
 * the device's own PIN or password. Which one appears is entirely up
 * to the OS — this file never sees or stores biometric data itself,
 * only the OS's yes/no answer.
 *
 * Used purely as a local re-lock, the same trust model the 4-digit PIN
 * already uses: a credential is registered once per device and its id
 * kept in device-local storage (see store.js `device`), and unlocking
 * later just asks "does this device still recognise the person holding
 * it" — nobody's identity is being asserted to a server. That is also
 * why registration needs no server round trip: the challenge is a
 * throwaway, generated and thrown away entirely on this device.
 */

import { device } from './store.js';

const CRED_KEY = 'bioCredId';

function supportsWebAuthn() {
  return typeof window !== 'undefined'
    && window.PublicKeyCredential
    && typeof navigator.credentials !== 'undefined';
}

/**
 * Whether this device can actually show a biometric/lock-screen prompt
 * right now — not just whether the WebAuthn API exists. A laptop with
 * no fingerprint reader and no Windows Hello has the API but nothing
 * behind it, and asking anyway would fail in a confusing way.
 */
export async function biometricAvailable() {
  if (!supportsWebAuthn()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function biometricEnabled() {
  return Boolean(device.get(CRED_KEY));
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function toB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)).buffer;
}

/**
 * Registers this device's biometric/lock-screen as the fast path past
 * the gate. The PIN stays set and stays the fallback — this only adds
 * a quicker door next to it, and is why it is offered from Settings
 * only once a PIN already exists.
 */
export async function enrollBiometric(label = 'Kontour') {
  if (!(await biometricAvailable())) {
    throw new Error('This device has no Face ID, fingerprint or screen-lock unlock available to Chrome.');
  }

  const cred = await navigator.credentials.create({
    publicKey: {
      // Thrown away the moment this call returns — nothing here is
      // ever checked against anything, so it needs no server.
      challenge: randomBytes(32),
      rp: { name: label, id: location.hostname },
      // A stable but content-free id: this is a device lock, not an
      // account, so there is no real user identity to attach it to.
      user: {
        id: randomBytes(16),
        name: 'this device',
        displayName: 'This device',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },    // ES256
        { type: 'public-key', alg: -257 },  // RS256, older Android/Windows
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  });

  if (!cred) throw new Error('Enrollment was cancelled.');
  device.set(CRED_KEY, toB64(cred.rawId));
  return true;
}

/**
 * Prompts Face ID / fingerprint / the device lock and resolves to
 * whether it succeeded. Never throws on a user cancel or a failed
 * scan — those are ordinary outcomes here, not errors the caller
 * needs to handle specially; the PIN pad underneath is always the
 * fallback either way.
 */
export async function verifyBiometric() {
  const credId = device.get(CRED_KEY);
  if (!credId) return false;

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ id: fromB64(credId), type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return Boolean(assertion);
  } catch {
    // NotAllowedError (cancelled or timed out), InvalidStateError (the
    // credential was removed at the OS level), or anything else — all
    // read the same from here: it did not work, try the PIN.
    return false;
  }
}

export function disableBiometric() {
  device.set(CRED_KEY, null);
}
