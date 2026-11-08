const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_TIMEOUT_MS = 20000;
const GEMINI_MODELS = ["gemini-2.0-flash-001", "gemini-2.0-flash", "gemini-1.5-flash"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { message, marketContext, conversationHistory } = await req.json();

    if (!message) {
      return new Response(
        JSON.stringify({ error: "Missing required field: message" }),
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

    const contextStr = marketContext
      ? `Current market context:
- Coin: ${marketContext.coin || "N/A"}
- Price: ${marketContext.price ? "$" + marketContext.price : "N/A"}
- 24h Change: ${marketContext.change24h ? marketContext.change24h + "%" : "N/A"}
- RSI: ${marketContext.rsi || "N/A"}
- Trend: ${marketContext.trend || "N/A"}
- Detected Pattern: ${marketContext.pattern || "None"}
- Fear & Greed Index: ${marketContext.fearGreed || "N/A"}`
      : "";

    const historyStr = Array.isArray(conversationHistory) && conversationHistory.length > 0
      ? "Previous conversation:\n" + conversationHistory
          .slice(-8)
          .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
          .join("\n")
      : "";

    const systemPrompt = `You are PatternHunter AI, an expert cryptocurrency trading assistant integrated into a real-time crypto pattern detection app.
You help users understand market conditions, analyze patterns, and make informed trading decisions.
You have access to real-time market data that is provided as context.

${contextStr}

${historyStr}

Guidelines:
- Be concise but thorough. Use clear, professional language.
- When users ask to "show" or "display" a coin chart, respond with: [ACTION:show_chart:SYMBOL] where SYMBOL is the coin symbol (e.g., BTC, ETH).
- When users mention "buy" or "sell" a coin, acknowledge and provide analysis but remind them this is educational, not financial advice.
- Always include a disclaimer when giving trade-related advice.
- If asked about specific price levels, use the provided market context.
- Keep responses under 150 words unless the user specifically asks for detail.
- Use simple formatting — no markdown headers, just plain text with line breaks.`;

    const prompt = `${systemPrompt}\n\nUser: ${message}\n\nPatternHunter AI:`;

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
              generationConfig: { temperature: 0.6, maxOutputTokens: 500 },
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
        lastError = fetchErr instanceof Error ? fetchErr.message : "Unknown fetch error";
        continue;
      }
    }

    if (geminiText) {
      return new Response(
        JSON.stringify({ response: geminiText }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ unavailable: true, error: lastError || "AI chat unavailable" }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ unavailable: true, error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
