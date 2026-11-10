import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const ALLOWED_ORIGIN = Deno.env.get("FRONTEND_ORIGIN") || "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-MBX-APIKEY, x-mbx-apikey",
};

interface ProxyPayload {
  target: "spot" | "futures";
  path: string;
  method?: "GET" | "POST" | "DELETE" | "PUT";
  query?: string;
  body?: string;
  headers?: Record<string, string>;
  signWithServerSecret?: boolean;
}

const ALLOWED_ENDPOINTS: Record<"spot" | "futures", string[]> = {
  spot: [
    "/api/v3/ping",
    "/api/v3/time",
    "/api/v3/ticker/price",
    "/api/v3/ticker/24hr",
    "/api/v3/klines",
    "/api/v3/depth",
    "/api/v3/trades",
    "/api/v3/account",
    "/api/v3/order",
    "/api/v3/openOrders",
    "/api/v3/allOrders",
    "/api/v3/myTrades",
  ],
  futures: [
    "/fapi/v1/ping",
    "/fapi/v1/time",
    "/fapi/v1/ticker/price",
    "/fapi/v1/ticker/24hr",
    "/fapi/v1/klines",
    "/fapi/v1/depth",
    "/fapi/v1/trades",
    "/fapi/v2/account",
    "/fapi/v2/balance",
    "/fapi/v1/positionRisk",
    "/fapi/v1/order",
    "/fapi/v1/openOrders",
    "/fapi/v1/allOrders",
    "/fapi/v1/userTrades",
    "/fapi/v1/leverage",
    "/fapi/v1/marginType",
  ],
};

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 120;
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }

  record.count += 1;
  return true;
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: Missing valid session Bearer token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    let userId = "anonymous";
    if (supabaseUrl && supabaseAnonKey) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
      });
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized: Invalid or expired session token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = user.id;
    }

    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown-ip";
    const rateLimitKey = `${userId}:${clientIp}`;
    if (!checkRateLimit(rateLimitKey)) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded (120 req/min). Please try again shortly." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload: ProxyPayload = await req.json();
    const { target, path, method = "GET", query = "", body, headers = {}, signWithServerSecret = false } = payload;

    if (!target || !path) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: target ('spot' | 'futures') or path" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (target !== "spot" && target !== "futures") {
      return new Response(
        JSON.stringify({ error: "Invalid target: must be 'spot' or 'futures'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const allowedList = ALLOWED_ENDPOINTS[target] || [];
    const isWhitelisted = allowedList.some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
    if (!isWhitelisted) {
      console.warn(`[Proxy Blocked] User ${userId} requested unwhitelisted endpoint: [${target}] ${path}`);
      return new Response(
        JSON.stringify({ error: `Forbidden: Endpoint '${path}' is not in the allowed proxy whitelist.` }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = target === "futures" ? "https://fapi.binance.com" : "https://api.binance.com";
    let finalQuery = query;

    const outgoingHeaders: Record<string, string> = { ...headers };
    const authKey = req.headers.get("x-mbx-apikey") || req.headers.get("X-MBX-APIKEY") || outgoingHeaders["X-MBX-APIKEY"];
    if (authKey) {
      outgoingHeaders["X-MBX-APIKEY"] = authKey;
    }

    const serverApiKey = Deno.env.get("BINANCE_SERVER_API_KEY");
    const serverApiSecret = Deno.env.get("BINANCE_SERVER_API_SECRET");
    if (signWithServerSecret && serverApiKey && serverApiSecret) {
      outgoingHeaders["X-MBX-APIKEY"] = serverApiKey;
      const timestamp = Date.now();
      const queryParams = new URLSearchParams(query);
      if (!queryParams.has("timestamp")) {
        queryParams.set("timestamp", String(timestamp));
      }
      const rawQuery = queryParams.toString();
      const signature = await hmacSha256(serverApiSecret, rawQuery);
      queryParams.set("signature", signature);
      finalQuery = queryParams.toString();
    }

    const fullUrl = finalQuery ? `${baseUrl}${path}?${finalQuery}` : `${baseUrl}${path}`;

    const fetchOptions: RequestInit = {
      method,
      headers: outgoingHeaders,
    };

    if (body && (method === "POST" || method === "PUT" || method === "DELETE")) {
      fetchOptions.body = body;
    }

    console.info(`[BinanceProxy] User: ${userId} | ${method} ${target.toUpperCase()} ${path}`);

    const binanceRes = await fetch(fullUrl, fetchOptions);
    const resText = await binanceRes.text();

    return new Response(resText, {
      status: binanceRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": binanceRes.headers.get("content-type") || "application/json",
      },
    });
  } catch (err) {
    console.error("[BinanceProxy Error]", err instanceof Error ? err.message : err);
    return new Response(
      JSON.stringify({ error: "Binance Proxy internal processing error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
