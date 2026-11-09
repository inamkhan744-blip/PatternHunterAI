const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-MBX-APIKEY, x-mbx-apikey",
};

interface ProxyPayload {
  target: "spot" | "futures";
  path: string; // e.g. "/api/v3/account" or "/fapi/v1/order"
  method?: "GET" | "POST" | "DELETE" | "PUT";
  query?: string;
  body?: string;
  headers?: Record<string, string>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const payload: ProxyPayload = await req.json();
    const { target, path, method = "GET", query = "", body, headers = {} } = payload;

    if (!target || !path) {
      return new Response(
        JSON.stringify({ error: "Missing target ('spot' | 'futures') or path" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = target === "futures" ? "https://fapi.binance.com" : "https://api.binance.com";
    const fullUrl = query ? `${baseUrl}${path}?${query}` : `${baseUrl}${path}`;

    const outgoingHeaders: Record<string, string> = { ...headers };
    // Pass along X-MBX-APIKEY if present in request headers
    const authKey = req.headers.get("x-mbx-apikey") || req.headers.get("X-MBX-APIKEY");
    if (authKey && !outgoingHeaders["X-MBX-APIKEY"]) {
      outgoingHeaders["X-MBX-APIKEY"] = authKey;
    }

    const fetchOptions: RequestInit = {
      method,
      headers: outgoingHeaders,
    };

    if (body && (method === "POST" || method === "PUT" || method === "DELETE")) {
      fetchOptions.body = body;
    }

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
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Binance Proxy internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
