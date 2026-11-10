const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, Authorization, X-Client-Info, Apikey, Content-Type",
};

interface WebhookPayload {
  action?: "buy" | "sell" | "BUY" | "SELL" | string;
  ticker?: string;
  symbol?: string;
  price?: number;
  message?: string;
  token?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const queryToken = url.searchParams.get("token");

    let rawBody = "";
    try {
      rawBody = await req.text();
    } catch {
      rawBody = "";
    }

    let parsed: Partial<WebhookPayload> = {};
    if (rawBody.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = { message: rawBody };
      }
    } else {
      parsed = { message: rawBody };
    }

    const token = parsed.token || queryToken || req.headers.get("x-webhook-token") || "";
    const lowerMessage = (parsed.message || rawBody || "").toLowerCase();
    const actionField = (parsed.action || "").toLowerCase();

    let signalDirection: "BUY" | "SELL" | null = null;
    if (actionField === "buy" || lowerMessage.includes("buy") || lowerMessage.includes("long")) {
      signalDirection = "BUY";
    } else if (actionField === "sell" || lowerMessage.includes("sell") || lowerMessage.includes("short")) {
      signalDirection = "SELL";
    }

    let symbol = parsed.symbol || parsed.ticker || "";
    if (!symbol) {
      const match = lowerMessage.match(/\b([a-z0-9]{3,10}usdt)\b/i) || lowerMessage.match(/\b([a-z0-9]{3,6})\b/i);
      if (match) {
        symbol = match[1].toUpperCase();
        if (!symbol.endsWith("USDT") && symbol.length <= 5) {
          symbol = `${symbol}USDT`;
        }
      }
    }
    if (!symbol) {
      symbol = "BTCUSDT";
    }

    const price = typeof parsed.price === "number" ? parsed.price : undefined;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    // Broadcast signal via Supabase Realtime broadcast REST endpoint so active browser sessions receive it live
    if (supabaseUrl && supabaseAnonKey && signalDirection) {
      try {
        await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            messages: [
              {
                topic: `tradingview-signals:${token || "global"}`,
                event: "signal",
                payload: {
                  direction: signalDirection,
                  symbol: symbol.toUpperCase(),
                  price,
                  token,
                  timestamp: Date.now(),
                },
              },
            ],
          }),
        }).catch(() => {});
      } catch {
        // Silently continue if realtime service is unavailable
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        received: true,
        direction: signalDirection,
        symbol: symbol.toUpperCase(),
        price,
        tokenValidated: Boolean(token),
        timestamp: Date.now(),
        raw: rawBody.slice(0, 500),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Failed to parse webhook",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
