/**
 * Shared security primitives for PatternHunter edge functions.
 *
 * Everything in this module runs server-side only. It provides:
 *  - strict CORS
 *  - JWT verification against Supabase Auth
 *  - durable, per-user rate limiting backed by Postgres (works across isolates)
 *  - AES-256-GCM envelope encryption for stored exchange credentials
 *  - constant-time comparison helpers
 */

import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.48.0";

/**
 * Comma-separated allow-list, e.g.
 *   FRONTEND_ORIGIN="https://patternhunter.vercel.app,https://*.vercel.app"
 * Entries may contain `*` to match a whole label (Vercel preview deployments).
 * An empty setting falls back to `*`; that is acceptable because every endpoint
 * still requires a bearer JWT and none of them rely on cookies.
 */
const CONFIGURED_ORIGINS = (Deno.env.get("FRONTEND_ORIGIN") ?? "")
  .split(",")
  .map((value) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `origin` is on the allow-list (or the list is empty). */
export function originAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (CONFIGURED_ORIGINS.length === 0) return true;
  const normalized = origin.replace(/\/+$/, "");
  return CONFIGURED_ORIGINS.some((allowed) => {
    if (!allowed.includes("*")) return allowed === normalized;
    const pattern = new RegExp(
      `^${allowed.split("*").map(escapeRegExp).join("[^/]*")}$`,
      "i"
    );
    return pattern.test(normalized);
  });
}

function allowOriginHeader(req?: Request): string {
  const origin = req?.headers.get("Origin") ?? null;
  if (origin && originAllowed(origin)) return origin;
  return CONFIGURED_ORIGINS[0] ?? "*";
}

export function corsHeaders(req?: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowOriginHeader(req),
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-timestamp, x-webhook-signature",
    "Access-Control-Max-Age": "600",
  };
}

/**
 * Rewrites a response's CORS headers to echo the caller's Origin when it is
 * allowed. Wrapping the whole handler means every response — success, 4xx, 5xx
 * and the preflight — carries a header the browser will accept.
 */
export function withCors(req: Request, res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", allowOriginHeader(req));
  headers.set("Vary", "Origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}

/** Service-role client. NEVER expose this key or client to the browser. */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("Supabase service credentials are not configured");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AuthResult {
  user: User | null;
  response?: Response;
}

/** Verifies the caller's Supabase JWT. Returns a 401 response when invalid. */
export async function requireUser(req: Request): Promise<AuthResult> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return { user: null, response: json({ error: "Unauthorized: missing bearer token" }, 401) };
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    return { user: null, response: json({ error: "Authentication backend unavailable" }, 503) };
  }

  try {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      return { user: null, response: json({ error: "Unauthorized: invalid or expired session" }, 401) };
    }
    return { user: data.user };
  } catch {
    return { user: null, response: json({ error: "Unauthorized: session verification failed" }, 401) };
  }
}

/**
 * Durable per-user rate limit. Uses the `consume_rate_limit` SECURITY DEFINER
 * function so the counter survives isolate restarts and is shared by all workers.
 * Fails closed on infrastructure errors.
 */
export async function enforceRateLimit(
  userId: string,
  scope: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const { data, error } = await adminClient().rpc("consume_rate_limit", {
      p_key: `${scope}:${userId}`,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// AES-256-GCM envelope encryption for stored API credentials
// ---------------------------------------------------------------------------

const IV_BYTES = 12;
const KEY_BYTES = 32;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Loads the 32-byte AES key from the CREDENTIALS_ENCRYPTION_KEY secret (base64). */
async function credentialKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("CREDENTIALS_ENCRYPTION_KEY") ?? "";
  if (!raw) throw new Error("CREDENTIALS_ENCRYPTION_KEY secret is not configured");
  const bytes = base64ToBytes(raw.trim());
  if (bytes.length !== KEY_BYTES) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 raw bytes encoded as base64");
  }
  return await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypts UTF-8 text. Output format: `v1.<iv_b64>.<ciphertext_and_tag_b64>`. */
export async function encryptSecret(plainText: string): Promise<string> {
  const key = await credentialKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plainText)
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(cipher))}`;
}

/** Decrypts a value produced by `encryptSecret`. Throws on tampering. */
export async function decryptSecret(bundle: string): Promise<string> {
  const parts = bundle.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Malformed ciphertext");
  const iv = base64ToBytes(parts[1]);
  const cipher = base64ToBytes(parts[2]);
  if (iv.length !== IV_BYTES || cipher.length <= 16) throw new Error("Malformed ciphertext");
  const key = await credentialKey();
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, cipher);
  return new TextDecoder().decode(plain);
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison for tokens/signatures. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Accepts a plain symbol and returns a canonical upper-case form, or null. */
export function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return null;
  return symbol;
}

export function clampString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  // Strip control characters (including NUL/newlines) without a control-char regex.
  const sanitized = value
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 127 ? " " : ch;
    })
    .join("");
  return sanitized.slice(0, maxLength).trim();
}

export function finiteNumber(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}
