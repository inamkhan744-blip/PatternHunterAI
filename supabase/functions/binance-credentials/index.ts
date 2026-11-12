/**
 * binance-credentials — server-side encrypted credential vault.
 *
 * The browser posts API keys exactly once over TLS. They are encrypted with
 * AES-256-GCM using `CREDENTIALS_ENCRYPTION_KEY` (a Supabase secret that never
 * reaches the client) and stored in `user_exchange_credentials`, which grants no
 * privileges to `anon`/`authenticated`. Reads are never possible from the client:
 * `status` returns only a configured flag, the last four characters and a timestamp.
 *
 * The `binance-proxy` function decrypts server-side to sign requests. API secrets
 * are never returned, logged, or placed in browser storage.
 */

import {
  adminClient,
  clampString,
  decryptSecret,
  encryptSecret,
  enforceRateLimit,
  json,
  preflight,
  requireUser,
} from "../_shared/security.ts";

const ALLOWED_EXCHANGES = new Set(["binance", "bybit", "okx", "kucoin"]);
const MIN_SECRET_LENGTH = 8;
const MAX_SECRET_LENGTH = 256;
const MAX_PASSPHRASE_LENGTH = 128;

interface CredentialRow {
  key_last4: string | null;
  updated_at: string | null;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const auth = await requireUser(req);
    if (!auth.user) return auth.response!;
    const userId = auth.user.id;

    const allowed = await enforceRateLimit(userId, "binance-credentials", 20, 60);
    if (!allowed) {
      return json({ error: "Rate limit exceeded (20 requests/minute)." }, 429);
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const action = clampString(payload.action, 16);
    const exchange = clampString(payload.exchange ?? "binance", 16) || "binance";

    if (!ALLOWED_EXCHANGES.has(exchange)) {
      return json({ error: "Unsupported exchange" }, 400);
    }

    const supabase = adminClient();

    const readStatus = async () => {
      const { data, error } = await supabase
        .from("user_exchange_credentials")
        .select("key_last4, updated_at")
        .eq("user_id", userId)
        .eq("exchange", exchange)
        .maybeSingle();

      if (error) throw new Error("Credential status lookup failed");
      const row = data as CredentialRow | null;
      return {
        configured: Boolean(row),
        apiKeyLast4: row?.key_last4 ?? null,
        updatedAt: row?.updated_at ?? null,
      };
    };

    if (action === "status") {
      return json({ status: await readStatus() });
    }

    if (action === "delete") {
      const { error } = await supabase
        .from("user_exchange_credentials")
        .delete()
        .eq("user_id", userId)
        .eq("exchange", exchange);

      if (error) {
        console.error("[binance-credentials] delete failed:", error.message);
        return json({ error: "Failed to delete credentials" }, 500);
      }

      return json({ status: { configured: false, apiKeyLast4: null, updatedAt: null } });
    }

    if (action !== "save") {
      return json({ error: "Unsupported action" }, 400);
    }

    // --- save ---------------------------------------------------------------
    const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
    const apiSecret = typeof payload.apiSecret === "string" ? payload.apiSecret.trim() : "";
    const passphrase = typeof payload.passphrase === "string" ? payload.passphrase.trim() : "";

    if (apiKey.length < MIN_SECRET_LENGTH || apiKey.length > MAX_SECRET_LENGTH) {
      return json({ error: "API key length must be between 8 and 256 characters" }, 400);
    }
    if (apiSecret.length < MIN_SECRET_LENGTH || apiSecret.length > MAX_SECRET_LENGTH) {
      return json({ error: "API secret length must be between 8 and 256 characters" }, 400);
    }
    if (!/^[A-Za-z0-9+/=_\-.]+$/.test(apiKey)) {
      return json({ error: "API key contains unsupported characters" }, 400);
    }
    if (passphrase.length > MAX_PASSPHRASE_LENGTH) {
      return json({ error: "Passphrase too long" }, 400);
    }

    const keyCiphertext = await encryptSecret(apiKey);
    const secretCiphertext = await encryptSecret(apiSecret);
    const passphraseCiphertext = passphrase ? await encryptSecret(passphrase) : null;

    // Self-check: never persist ciphertext we cannot decrypt with the current key.
    if ((await decryptSecret(secretCiphertext)) !== apiSecret) {
      return json({ error: "Encryption self-check failed" }, 500);
    }

    const { error: upsertError } = await supabase
      .from("user_exchange_credentials")
      .upsert(
        {
          user_id: userId,
          exchange,
          key_ciphertext: keyCiphertext,
          secret_ciphertext: secretCiphertext,
          passphrase_ciphertext: passphraseCiphertext,
          key_last4: apiKey.slice(-4),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,exchange" }
      );

    if (upsertError) {
      console.error("[binance-credentials] upsert failed:", upsertError.message);
      return json({ error: "Failed to store credentials securely" }, 500);
    }

    return json({ status: await readStatus() });
  } catch (err) {
    console.error("[binance-credentials] unexpected error:", err instanceof Error ? err.message : err);
    return json({ error: "Credential vault internal error" }, 500);
  }
});
