/**
 * binance-proxy — authenticated, rate-limited, allow-listed Binance gateway.
 *
 * SECURITY MODEL
 * --------------
 *  - The browser never holds Binance API keys. Credentials are stored encrypted by
 *    `binance-credentials` and decrypted here, server-side, only to sign a request.
 *  - The caller must present a valid Supabase JWT; every request is scoped to that
 *    user's own credentials (no cross-tenant access is possible).
 *  - Arbitrary headers/URLs are impossible: method, target and path are validated
 *    against an explicit allow-list, which also blocks SSRF.
 *  - Durable per-user rate limits (120/min, 1000/hour) are enforced in Postgres.
 *  - Nothing sensitive is logged: no keys, signatures are never echoed.
 */

import {
  adminClient,
  clampString,
  decryptSecret,
  enforceRateLimit,
  hmacSha256Hex,
  json,
  preflight,
  requireUser,
} from "../_shared/security.ts";

type Target = "spot" | "futures";
type Method = "GET" | "POST" | "DELETE" | "PUT";

const ALLOWED_METHODS: Method[] = ["GET", "POST", "DELETE", "PUT"];

const ALLOWED_ENDPOINTS: Record<Target, string[]> = {
  spot: [
    "/api/v3/ping",
    "/api/v3/time",
    "/api/v3/ticker/price",
    "/api/v3/ticker/bookTicker",
    "/api/v3/ticker/24hr",
    "/api/v3/klines",
    "/api/v3/depth",
    "/api/v3/trades",
    "/api/v3/account",
    "/api/v3/order",
    "/api/v3/openOrders",
    "/api/v3/allOrders",
    "/api/v3/myTrades",
    "/sapi/v1/futures/transfer",
  ],
  futures: [
    "/fapi/v1/ping",
    "/fapi/v1/time",
    "/fapi/v1/ticker/price",
    "/fapi/v1/ticker/bookTicker",
    "/fapi/v1/ticker/24hr",
    "/fapi/v1/klines",
    "/fapi/v1/depth",
    "/fapi/v1/trades",
    "/fapi/v2/account",
    "/fapi/v2/balance",
    "/fapi/v1/positionRisk",
    "/fapi/v1/order",
    "/fapi/v1/openOrders",
    "/fapi/v1/allOpenOrders",
    "/fapi/v1/allOrders",
    "/fapi/v1/userTrades",
    "/fapi/v1/leverage",
    "/fapi/v1/marginType",
  ],
};

/** Endpoints that never require a signature (public market data). */
const PUBLIC_PREFIXES = [
  "/api/v3/ping",
  "/api/v3/time",
  "/api/v3/ticker/",
  "/api/v3/klines",
  "/api/v3/depth",
  "/api/v3/trades",
  "/fapi/v1/ping",
  "/fapi/v1/time",
  "/fapi/v1/ticker/",
  "/fapi/v1/klines",
  "/fapi/v1/depth",
  "/fapi/v1/trades",
];

const MAX_QUERY_LENGTH = 2000;
const MAX_BODY_LENGTH = 4000;

function isPathAllowed(target: Target, path: string): boolean {
  if (!/^\/[A-Za-z0-9/_\-.]{1,80}$/.test(path)) return false;
  if (path.includes("..")) return false;
  return ALLOWED_ENDPOINTS[target].some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
}

function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

function looksLikeParams(value: string): boolean {
  if (!value) return true;
  if (value.length > MAX_BODY_LENGTH) return false;
  // Only urlencoded key=value pairs; blocks header/JSON smuggling.
  return /^[A-Za-z0-9%._~\-=&]*$/.test(value);
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

    const perMinute = await enforceRateLimit(userId, "binance-proxy:min", 120, 60);
    if (!perMinute) {
      return json({ error: "Rate limit exceeded (120 requests/minute)." }, 429);
    }
    const perHour = await enforceRateLimit(userId, "binance-proxy:hour", 1000, 3600);
    if (!perHour) {
      return json({ error: "Hourly limit reached (1000 requests/hour)." }, 429);
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    // Reject any attempt to supply client-side keying/headers.
    if (payload.headers !== undefined || payload.apiKey !== undefined || payload.signWithServerSecret !== undefined) {
      return json({ error: "Unsupported request fields" }, 400);
    }

    const target = clampString(payload.target, 16) as Target;
    if (target !== "spot" && target !== "futures") {
      return json({ error: "Invalid target: must be 'spot' or 'futures'" }, 400);
    }

    const path = clampString(payload.path, 90);
    if (!path || !isPathAllowed(target, path)) {
      console.warn(`[binance-proxy] blocked path for user ${userId}: ${path.slice(0, 90)}`);
      return json({ error: "Forbidden: endpoint is not in the proxy allow-list" }, 403);
    }

    const method = (clampString(payload.method ?? "GET", 8).toUpperCase() || "GET") as Method;
    if (!ALLOWED_METHODS.includes(method)) {
      return json({ error: "Invalid method" }, 400);
    }

    const rawQuery = typeof payload.query === "string" ? payload.query : "";
    const rawBody = typeof payload.body === "string" ? payload.body : "";

    if (rawQuery.length > MAX_QUERY_LENGTH || !looksLikeParams(rawQuery)) {
      return json({ error: "Invalid query string" }, 400);
    }
    if (rawBody.length > MAX_BODY_LENGTH || !looksLikeParams(rawBody)) {
      return json({ error: "Invalid request body" }, 400);
    }
    if (method !== "GET" && method !== "DELETE" && rawBody && rawQuery) {
      return json({ error: "Send parameters in either query or body, not both" }, 400);
    }

    const baseUrl = target === "futures" ? "https://fapi.binance.com" : "https://api.binance.com";
    const needsSignature = !isPublicPath(path);

    let url = `${baseUrl}${path}`;
    let outboundBody: string | undefined;
    const headers: Record<string, string> = { Accept: "application/json" };

    if (needsSignature) {
      // Load and decrypt this user's credentials. Never shared across tenants.
      const { data, error } = await adminClient()
        .from("user_exchange_credentials")
        .select("key_ciphertext, secret_ciphertext")
        .eq("user_id", userId)
        .eq("exchange", "binance")
        .maybeSingle();

      if (error) {
        console.error("[binance-proxy] credential lookup failed");
        return json({ error: "Credential lookup failed" }, 500);
      }
      if (!data) {
        return json({ error: "No Binance credentials stored. Add them in Settings first." }, 409);
      }

      let apiKey: string;
      let apiSecret: string;
      try {
        apiKey = await decryptSecret(String(data.key_ciphertext));
        apiSecret = await decryptSecret(String(data.secret_ciphertext));
      } catch {
        console.error("[binance-proxy] credential decryption failed");
        return json({ error: "Stored credentials could not be decrypted. Please re-save them." }, 500);
      }

      const params = new URLSearchParams(rawQuery);
      if (rawBody) {
        new URLSearchParams(rawBody).forEach((value, key) => params.set(key, value));
      }
      // The client is never trusted to set these.
      params.delete("signature");
      params.set("timestamp", String(Date.now()));
      params.set("recvWindow", "5000");

      const payloadString = params.toString();
      const signature = await hmacSha256Hex(apiSecret, payloadString);
      const signed = `${payloadString}&signature=${signature}`;

      headers["X-MBX-APIKEY"] = apiKey;

      if (method === "GET" || method === "DELETE") {
        url = `${url}?${signed}`;
      } else {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        outboundBody = signed;
      }
    } else if (rawQuery) {
      url = `${url}?${rawQuery}`;
    }

    console.info(`[binance-proxy] user=${userId} ${method} ${target.toUpperCase()} ${path}`);

    const upstream = await fetch(url, {
      method,
      headers,
      ...(outboundBody ? { body: outboundBody } : {}),
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "application/json";

    return new Response(text, {
      status: upstream.status,
      headers: {
        ...corsHeadersForResponse(),
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[binance-proxy] internal error:", err instanceof Error ? err.message : err);
    return json({ error: "Binance proxy internal processing error" }, 500);
  }
});

function corsHeadersForResponse(): Record<string, string> {
  // Reuse the shared CORS policy while keeping the response builder local.
  return {
    "Access-Control-Allow-Origin": Deno.env.get("FRONTEND_ORIGIN") || "*",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}
