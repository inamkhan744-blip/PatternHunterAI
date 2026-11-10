const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, Authorization, X-Client-Info, Apikey, Content-Type",
};

const GEMINI_TIMEOUT_MS = 25000;
const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-2.0-flash"];

function stripMarkdownJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/g, "")
    .replace(/```json\n?|```/g, "")
    .trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { action } = payload;

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response(
        JSON.stringify({ unavailable: true, error: "Backend GEMINI_API_KEY is not configured in Supabase secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Helper to query Gemini with fallback array ["gemini-1.5-flash", "gemini-2.0-flash"]
    async function callGemini(contents: unknown[], generationConfig?: Record<string, unknown>) {
      let lastError = "";
      for (const model of GEMINI_MODELS) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents,
                generationConfig: generationConfig || { temperature: 0.4, maxOutputTokens: 800 },
              }),
              signal: controller.signal,
            }
          );
          clearTimeout(timeoutId);

          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            lastError = `Gemini API error (${res.status}) on ${model}: ${errBody}`;
            console.warn(lastError);
            continue;
          }

          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.trim().length > 0) {
            return { text: text.trim(), model };
          }
          lastError = `Empty response from model ${model}`;
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          lastError = fetchErr instanceof Error ? fetchErr.message : "Unknown fetch error";
          console.warn(`Fetch error on ${model}:`, lastError);
          continue;
        }
      }
      throw new Error(lastError || "All Gemini fallback models failed");
    }

    // Case 1: Swarm Debate Generation
    if (action === "swarm") {
      const {
        symbol,
        price,
        rsi = 50,
        trend = "neutral",
        patternName = "Consolidation",
        patternDirection = "neutral",
        fearGreed = 50,
        atrValue = "N/A",
        spreadPct = "0.02%",
        confluenceScore = 50,
      } = payload;

      const prompt = `You are an elite hedge fund investment committee debating an algorithmic trade setup.
Asset: ${symbol}
Current Price: $${price}
RSI(14): ${rsi}
Trend: ${trend}
Pattern: ${patternName} (${patternDirection})
Fear & Greed Index: ${fearGreed}
ATR: ${atrValue}
Spread %: ${spreadPct}
Preliminary Confluence Score: ${confluenceScore}/100

Produce a JSON response strictly matching this schema with NO markdown code fences:
{
  "bullThesis": "Concise high-conviction bullish argument from Bull Agent (max 3 sentences)",
  "bullConfidence": 85,
  "bearThesis": "Concise risk/supply warning from Bear Agent (max 3 sentences)",
  "bearConfidence": 70,
  "riskVerdict": "GO" or "NO-GO",
  "riskThesis": "Concise risk assessment and sizing rationale from Risk Manager (max 3 sentences)",
  "recommendedDirection": "LONG" or "SHORT" or "HOLD",
  "recommendedLeverage": 3,
  "recommendedPositionPct": 2.5
}`;

      try {
        const { text, model } = await callGemini(
          [{ parts: [{ text: prompt }] }],
          {
            temperature: 0.3,
            maxOutputTokens: 600,
            responseMimeType: "application/json",
          }
        );

        const cleaned = stripMarkdownJson(text);
        const parsed = JSON.parse(cleaned);

        return new Response(
          JSON.stringify({ success: true, data: parsed, modelUsed: model }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ unavailable: true, error: err instanceof Error ? err.message : "Swarm debate failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Case 1.5: Pattern Explanation
    if (action === "explain") {
      const { patternName, direction, description, coin, price, recentCandles } = payload;
      if (!patternName || !coin || price === undefined) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: patternName, coin, price" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const candleSummary = Array.isArray(recentCandles)
        ? recentCandles.slice(-15).map((c: { close: number }) => (typeof c.close === "number" ? c.close.toFixed(2) : String(c.close))).join(", ")
        : "N/A";

      const prompt = `You are a Senior Quantitative Analyst & Pattern Specialist.
A technical pattern has been detected on ${coin}/USDT.
Pattern: ${patternName}
Direction: ${direction}
Description: ${description}
Current Price: $${price}
Recent Close Prices: ${candleSummary}

Produce a JSON response strictly matching this schema with NO markdown code fences:
{
  "explanation": "Pattern found: ${patternName} at $${Number(price).toFixed(2)}. ${direction === "bearish" ? "Expect a reversal to the downside." : "Expect a reversal to the upside."}\\nEntry: $<entry>\\nSL: $<sl>\\nTP: $<tp>\\nReasoning: <concise institutional rationale>",
  "entry": <calculated numeric entry price>,
  "sl": <calculated numeric stop loss price>,
  "tp": <calculated numeric take profit price>,
  "reasoning": "<1-2 sentences explaining why this pattern has institutional edge and the invalidation conditions>"
}`;

      try {
        const { text, model } = await callGemini(
          [{ parts: [{ text: prompt }] }],
          {
            temperature: 0.2,
            maxOutputTokens: 600,
            responseMimeType: "application/json",
          }
        );

        const cleaned = stripMarkdownJson(text);
        const parsed = JSON.parse(cleaned);

        return new Response(
          JSON.stringify({ success: true, data: parsed, modelUsed: model }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ unavailable: true, error: err instanceof Error ? err.message : "Pattern explanation failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Case 2: Vision Analysis
    if (action === "vision") {
      const { imageBase64, mimeType = "image/png", activeSymbol = "BTCUSDT" } = payload;
      if (!imageBase64) {
        return new Response(
          JSON.stringify({ error: "Missing required field: imageBase64" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const prompt = `You are a Senior Crypto Technical Analyst & Vision AI specialized in reading candlestick charts, order books, SMC liquidity zones, and technical patterns.
Carefully examine this candlestick chart image for ${activeSymbol}.
Identify:
1. Trend: Overall trend ("Bullish", "Bearish", or "Sideways/Consolidation") with an explanation.
2. Support & Resistance: The key visible support levels/zones and resistance levels/zones on the chart.
3. Patterns: All visible chart patterns (e.g. Double Bottom/Top, Head & Shoulders, Flags, Wedges, Fair Value Gaps, Order Blocks, Liquidity Sweeps) with direction ("bullish"|"bearish"|"neutral"), confidence (50-99), and description.
4. Key Takeaway: Concise trading recommendation, suggested action ("LONG"|"SHORT"|"WAIT"), and invalidation/stop-loss level.

Respond STRICTLY in valid JSON matching this schema:
{
  "trend": "Bullish" | "Bearish" | "Sideways/Consolidation",
  "trendReason": "Brief explanation of price structure and moving averages visible",
  "supportResistance": {
    "support": ["Level 1", "Level 2"],
    "resistance": ["Level 1", "Level 2"]
  },
  "patterns": [
    {
      "name": "Pattern Name",
      "direction": "bullish" | "bearish" | "neutral",
      "confidence": 85,
      "description": "Details regarding location and breakout target"
    }
  ],
  "suggestedAction": "LONG" | "SHORT" | "WAIT",
  "invalidationLevel": "Price level that invalidates this setup",
  "keyTakeaway": "1-2 sentence actionable summary for execution."
}`;

      try {
        const { text, model } = await callGemini(
          [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          {
            temperature: 0.2,
            maxOutputTokens: 800,
            responseMimeType: "application/json",
          }
        );

        const cleaned = stripMarkdownJson(text);
        const parsed = JSON.parse(cleaned);

        return new Response(
          JSON.stringify({ success: true, data: parsed, modelUsed: model }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ unavailable: true, error: err instanceof Error ? err.message : "Vision analysis failed" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Case 3: Standard PatternHunter AI Chat (Default)
    const { message, marketContext, conversationHistory } = payload;
    if (!message) {
      return new Response(
        JSON.stringify({ error: "Missing required field: message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    const { text, model } = await callGemini(
      [{ parts: [{ text: prompt }] }],
      { temperature: 0.6, maxOutputTokens: 500 }
    );

    return new Response(
      JSON.stringify({ response: text, modelUsed: model }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ unavailable: true, error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
