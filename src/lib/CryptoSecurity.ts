/**
 * Authenticated encryption helpers (AES-256-GCM, WebCrypto).
 *
 * SECURITY RULES ENFORCED HERE
 * ---------------------------
 * - No master key is ever read from `import.meta.env` / `VITE_*` variables: anything
 *   bundled into the SPA is public.
 * - No key is derived from `window.location.origin` or the user agent: those are
 *   attacker-controlled in the threat model this protects against.
 * - Only authenticated encryption (AES-GCM, 256-bit key, 96-bit random IV) is
 *   produced. Ciphertext is bound to its IV and authenticated with a 128-bit tag.
 * - Decryption never logs plaintext or key material.
 *
 * Trading API credentials are NOT stored by this module. They live server-side in
 * `user_exchange_credentials` encrypted by the `binance-credentials` edge function
 * (see lib/CredentialVault.ts). This module is used for local, non-authoritative
 * secrets (e.g. optional per-browser exchange placeholders) and is intentionally
 * explicit-key only.
 */

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const KEY_FORMAT_PREFIX = "v3_aes_gcm::";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const DEVICE_KEY_STORAGE = "fortress_device_key_v3";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importRawKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (raw.length !== KEY_BYTES) {
    throw new Error("Invalid key length: AES-256 requires a 32-byte key");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Random per-device key persisted locally. It provides at-rest obfuscation for
 * non-authoritative local values only; it is never treated as a trust boundary.
 */
export async function getDeviceKey(): Promise<CryptoKey> {
  if (typeof localStorage === "undefined") {
    throw new Error("Device key storage unavailable");
  }
  const stored = localStorage.getItem(DEVICE_KEY_STORAGE);
  if (stored) {
    return importRawKey(fromBase64(stored));
  }
  const generated = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  localStorage.setItem(DEVICE_KEY_STORAGE, toBase64(generated));
  return importRawKey(generated);
}

async function resolveKey(rawKey?: string): Promise<CryptoKey> {
  if (rawKey === undefined) return getDeviceKey();
  // Derive a fixed 32-byte key from any passphrase (SHA-256), never truncate/pad.
  const digest = await crypto.subtle.digest("SHA-256", ENCODER.encode(rawKey));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypts UTF-8 text with AES-256-GCM. Output: `v3_aes_gcm::<iv>:<ciphertext+tag>`. */
export async function encryptData(plainText: string, rawKey?: string): Promise<string> {
  if (!plainText) return "";
  const key = await resolveKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    ENCODER.encode(plainText) as unknown as BufferSource
  );
  return `${KEY_FORMAT_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(cipherBuffer))}`;
}

/**
 * Decrypts an AES-256-GCM bundle. Returns "" when the payload is malformed or the
 * authentication tag does not verify (tampering / wrong key).
 */
export async function decryptData(cipherBundle: string, rawKey?: string): Promise<string> {
  if (!cipherBundle || !cipherBundle.startsWith(KEY_FORMAT_PREFIX)) return "";
  try {
    const payload = cipherBundle.slice(KEY_FORMAT_PREFIX.length);
    const separator = payload.indexOf(":");
    if (separator <= 0) return "";

    const iv = fromBase64(payload.slice(0, separator));
    const ciphertext = fromBase64(payload.slice(separator + 1));
    if (iv.length !== IV_BYTES || ciphertext.length === 0) return "";

    const key = await resolveKey(rawKey);
    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      ciphertext
    );
    return DECODER.decode(plainBuffer);
  } catch {
    // Wrong key, tampered ciphertext or unsupported payload: fail closed.
    return "";
  }
}

/** Removes the local device key (used on sign-out / data wipe). */
export function clearDeviceKey(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(DEVICE_KEY_STORAGE);
}
