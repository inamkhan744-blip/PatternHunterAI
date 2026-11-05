const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_TIMEOUT_MS = 15000;
const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-2.0-flash-001", "gemini-2.0-flash"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { patternName, direction, description, coin, price, recentCandles } = await req.json();

    if (!patternName || !coin || price === undefined) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: patternName, coin, price" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ unavailable: true, error: "Gemini API key not configured." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const candleSummary = Array.isArray(recentCandles)
      ? recentCandles.slice(-15).map((c: { close: number }) => c.close.toFixed(2)).join(", ")
      : "N/A";

    const prompt = `You are an expert crypto trader and technical analyst. A pattern has been detected on the ${coin}/USDT chart.

Pattern: ${patternName}
Direction: ${direction}
Details: ${description}
Current price: $${price}
Recent close prices: ${candleSummary}

Write a concise, professional trading analysis in exactly this format (no extra text, no markdown headers):

Pattern found: ${patternName} at $${price.toFixed(2)}. ${direction === "bearish" ? "Expect a reversal to the downside." : "Expect a reversal to the upside."}
Entry: $<entry price>
SL: $<stop loss price>
TP: $<take profit price>
Reasoning: <1-2 sentences explaining the pattern and market context>

Calculate Entry, SL, and TP based on the current price of $${price} and the ${direction} direction. Use realistic percentages (Entry within 0.3%, SL within 0.5-1%, TP within 1-3%). Round all prices to 2 decimal places. Keep it under 5 lines total.`;

    let geminiText: string | null = null;
    let lastError = "";

    for (const model of GEMINI_MODELS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
            }),
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        if (!geminiRes.ok) {
          lastError = `Gemini API error (${geminiRes.status}) for model ${model}`;
          continue;
        }

        const geminiData = await geminiRes.json();
        const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 0) {
          geminiText = text.trim();
          break;
        }
        lastError = `Empty response from model ${model}`;
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
          lastError = `Request to model ${model} timed out after ${GEMINI_TIMEOUT_MS / 1000}s`;
        } else {
          lastError = fetchErr instanceof Error ? fetchErr.message : "Unknown fetch error";
        }
        continue;
      }
    }

    if (geminiText) {
      return new Response(
        JSON.stringify({ explanation: geminiText }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ unavailable: true, error: lastError || "AI analysis unavailable" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ unavailable: true, error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
