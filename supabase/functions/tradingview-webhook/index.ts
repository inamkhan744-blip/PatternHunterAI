/**
 * tradingview-webhook — authenticated TradingView alert ingestion.
 *
 * SECURITY MODEL
 * --------------
 *  - Every alert must carry a per-user 256-bit token issued by
 *    `get_or_create_webhook_token()`. Tokens are looked up by SHA-256 hash with a
 *    constant-time comparison. Unknown tokens are rejected (the previous
 *    `tokenValidated: Boolean(token)` logic accepted any string and is removed).
 *  - A timestamp is mandatory and must be within +/- 300 s of server time.
 *  - Optional HMAC-SHA256 signature over `${timestamp}.${action}.${symbol}.${price}`
 *    (body field `signature` or header `x-webhook-signature`). Set
 *    REQUIRE_WEBHOOK_SIGNATURE=true to make it mandatory for scripted clients.
 *  - Replay protection: a delivery id is inserted into `webhook_replay_guard`;
 *    duplicates are rejected with 409.
 *  - Payloads are validated and never echoed back.
 */

import {
  adminClient,
  clampString,
  finiteNumber,
  hmacSha256Hex,
  json,
  normalizeSymbol,
  preflight,
  sha256Hex,
  timingSafeEqual,
} from "../_shared/security.ts";

const MAX_BODY_CHARS = 8000;
const MAX_CLOCK_SKEW_SECONDS = 300;
const REQUIRE_SIGNATURE = (Deno.env.get("REQUIRE_WEBHOOK_SIGNATURE") || "false").toLowerCase() === "true";

interface WebhookSecretRow {
  user_id: string;
  token_hash: string;
  signing_secret: string;
}

interface WebhookPayload {
  action?: string;
  ticker?: string;
  symbol?: string;
  price?: number;
  message?: string;
  token?: string;
  timestamp?: number | string;
  signature?: string;
}

function unauthorized(message: string): Response {
  return json({ success: false, error: message }, 401);
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);

    const rawBody = (await req.text()).slice(0, MAX_BODY_CHARS);
    if (!rawBody.trim()) {
      return json({ success: false, error: "Empty webhook body" }, 400);
    }

    let parsed: WebhookPayload = {};
    if (rawBody.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(rawBody) as WebhookPayload;
      } catch {
        return json({ success: false, error: "Malformed JSON payload" }, 400);
      }
    }

    // --- 1. Token authentication ------------------------------------------
    const token = clampString(
      req.headers.get("x-webhook-token") ?? parsed.token ?? url.searchParams.get("token") ?? "",
      200
    );
    if (!token || token.length < 20) {
      return unauthorized("Missing or malformed webhook token");
    }

    const tokenHash = await sha256Hex(token);
    const supabase = adminClient();

    const { data: secretRow, error: secretError } = await supabase
      .from("user_webhook_secrets")
      .select("user_id, token_hash, signing_secret")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (secretError) {
      console.error("[tradingview-webhook] secret lookup failed");
      return json({ success: false, error: "Webhook verification unavailable" }, 503);
    }
    if (!secretRow) {
      return unauthorized("Invalid webhook token");
    }

    const secret = secretRow as WebhookSecretRow;
    if (!timingSafeEqual(secret.token_hash, tokenHash)) {
      return unauthorized("Invalid webhook token");
    }

    // --- 2. Timestamp freshness -------------------------------------------
    const parsedTimestamp = Number(
      clampString(req.headers.get("x-webhook-timestamp") ?? String(parsed.timestamp ?? ""), 24)
    );
    if (!Number.isFinite(parsedTimestamp) || parsedTimestamp <= 0) {
      return unauthorized("Missing webhook timestamp");
    }
    const timestampSeconds =
      parsedTimestamp > 1e12 ? Math.floor(parsedTimestamp / 1000) : Math.floor(parsedTimestamp);
    if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
      return unauthorized("Stale webhook timestamp (replay window exceeded)");
    }

    // --- 3. Payload validation (before signature so it covers parsed values)
    const actionField = clampString(parsed.action, 16).toLowerCase();
    const message = clampString(parsed.message, 500).toLowerCase();

    let direction: "BUY" | "SELL" | null = null;
    if (actionField === "buy" || actionField === "long") direction = "BUY";
    else if (actionField === "sell" || actionField === "short") direction = "SELL";
    else if (/\b(buy|long)\b/.test(message)) direction = "BUY";
    else if (/\b(sell|short)\b/.test(message)) direction = "SELL";

    if (!direction) {
      return json({ success: false, error: "Unrecognised webhook action" }, 422);
    }

    const symbol = normalizeSymbol(parsed.symbol ?? parsed.ticker);
    if (!symbol) {
      return json({ success: false, error: "Missing or invalid symbol" }, 422);
    }

    const price = parsed.price === undefined ? null : finiteNumber(parsed.price, 0, 1e12);
    if (parsed.price !== undefined && price === null) {
      return json({ success: false, error: "Invalid price" }, 422);
    }

    // --- 4. Optional HMAC signature ---------------------------------------
    const suppliedSignature = clampString(
      req.headers.get("x-webhook-signature") ?? parsed.signature ?? "",
      200
    ).replace(/^sha256=/i, "");

    const canonical = `${timestampSeconds}.${actionField || direction}.${symbol}.${price ?? ""}`;

    let signatureValidated = false;
    if (suppliedSignature) {
      const expected = await hmacSha256Hex(secret.signing_secret, canonical);
      if (!timingSafeEqual(expected, suppliedSignature.toLowerCase())) {
        return unauthorized("Invalid webhook signature");
      }
      signatureValidated = true;
    } else if (REQUIRE_SIGNATURE) {
      return unauthorized("Webhook signature required");
    }

    // --- 5. Replay guard --------------------------------------------------
    const deliveryId = await sha256Hex(`${secret.token_hash}:${canonical}`);
    const { error: replayError } = await supabase
      .from("webhook_replay_guard")
      .insert({ delivery_id: deliveryId, user_id: secret.user_id });

    if (replayError) {
      if (replayError.code === "23505") {
        return json({ success: false, error: "Duplicate webhook delivery rejected" }, 409);
      }
      console.error("[tradingview-webhook] replay guard failed");
      return json({ success: false, error: "Webhook verification unavailable" }, 503);
    }

    // Opportunistic retention: keep the guard table small.
    await supabase
      .from("webhook_replay_guard")
      .delete()
      .lt("received_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .then(() => undefined, () => undefined);

    // --- 6. Notify only the owning user ----------------------------------
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceKey) {
      await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          messages: [
            {
              topic: `tradingview-signals:${secret.user_id}`,
              event: "signal",
              payload: {
                direction,
                symbol,
                price,
                receivedAt: new Date().toISOString(),
                signatureValidated,
              },
            },
          ],
        }),
      }).catch(() => undefined);
    }

    // No raw body echo: alerts may contain broker-specific identifiers.
    return json({
      success: true,
      received: true,
      direction,
      symbol,
      price,
      signatureValidated,
      timestamp: timestampSeconds,
    });
  } catch (err) {
    console.error("[tradingview-webhook] unexpected error:", err instanceof Error ? err.message : err);
    return json({ success: false, error: "Webhook processing failed" }, 400);
  }
});
