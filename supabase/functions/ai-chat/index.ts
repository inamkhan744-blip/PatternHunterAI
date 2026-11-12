/**
 * ai-chat — PatternHunter AI assistant, swarm debate, pattern explanation and
 * vision analysis.
 *
 * Security controls:
 *  - Requires a valid Supabase JWT (no anonymous use of platform AI credits).
 *  - Per-user durable rate limits (20/min, 300/hour).
 *  - Strict input validation: action allow-list, bounded string lengths, bounded
 *    history/candle arrays, bounded base64 image size.
 *  - Prompt-injection resistant: user text is length-limited and control chars are
 *    stripped before being embedded in prompts.
 *  - Errors are returned without leaking upstream payloads.
 */

import {
  clampString,
  enforceRateLimit,
  finiteNumber,
  json,
  normalizeSymbol,
  preflight,
  requireUser,
} from "../_shared/security.ts";

const GEMINI_TIMEOUT_MS = 25000;
const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-2.0-flash"];
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_ITEMS = 10;
const MAX_IMAGE_BASE64_CHARS = 4_000_000; // ~3 MB binary
const ALLOWED_ACTIONS = new Set(["swarm", "explain", "vision", "chat"]);
const MAX_MARKET_DATA_AGE_MS = 15 * 60 * 1000;

/**
 * Rejects stale market context. An LLM asked to analyse minutes-old (or missing)
 * data will confidently describe it as current, which is exactly the hallucination
 * this guard prevents.
 */
function marketDataAgeError(raw: unknown): string | null {
  const ts = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(ts) || ts <= 0) {
    return "Market data timestamp is required (dataTimestamp) before AI analysis.";
  }
  const ageMs = Date.now() - ts;
  if (ageMs < -60_000) return "Market data timestamp is in the future; refusing to analyse.";
  if (ageMs > MAX_MARKET_DATA_AGE_MS) {
    return `Market data is ${Math.round(ageMs / 60000)} minutes old (max 15). Refresh the chart and retry.`;
  }
  return null;
}

function validSwarmPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const bull = typeof o.bullThesis === "string" ? o.bullThesis.trim().slice(0, 700) : "";
  const bear = typeof o.bearThesis === "string" ? o.bearThesis.trim().slice(0, 700) : "";
  const risk = typeof o.riskThesis === "string" ? o.riskThesis.trim().slice(0, 700) : "";
  const verdict = o.riskVerdict === "GO" || o.riskVerdict === "NO-GO" ? o.riskVerdict : null;
  const direction = ["LONG", "SHORT", "HOLD"].includes(String(o.recommendedDirection))
    ? String(o.recommendedDirection)
    : null;

  if (!bull || !bear || !verdict || !direction) return null;

  const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  return {
    bullThesis: bull,
    bullConfidence: clampNum(o.bullConfidence, 0, 100, 50),
    bearThesis: bear,
    bearConfidence: clampNum(o.bearConfidence, 0, 100, 50),
    riskVerdict: verdict,
    riskThesis: risk || "Risk thesis omitted by model.",
    recommendedDirection: direction,
    recommendedLeverage: clampNum(o.recommendedLeverage, 1, 10, 1),
    recommendedPositionPct: clampNum(o.recommendedPositionPct, 0, 10, 0),
  };
}

function stripMarkdownJson(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/g, "")
    .replace(/```json\n?|```/g, "")
    .trim();
}

function parseJsonResponse(text: string): unknown {
  return JSON.parse(stripMarkdownJson(text));
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // --- 1. Authentication -------------------------------------------------
    const auth = await requireUser(req);
    if (!auth.user) return auth.response!;

    // --- 2. Rate limiting --------------------------------------------------
    const perMinute = await enforceRateLimit(auth.user.id, "ai-chat:min", 20, 60);
    if (!perMinute) {
      return json({ error: "Rate limit exceeded (20 requests/minute). Please slow down." }, 429);
    }
    const perHour = await enforceRateLimit(auth.user.id, "ai-chat:hour", 300, 3600);
    if (!perHour) {
      return json({ error: "Hourly AI request limit reached (300/hour). Try again later." }, 429);
    }

    // --- 3. Input validation ----------------------------------------------
    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const action = clampString(payload.action ?? "chat", 24) || "chat";
    if (!ALLOWED_ACTIONS.has(action)) {
      return json({ error: "Unsupported action" }, 400);
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return json({ unavailable: true, error: "Backend GEMINI_API_KEY is not configured." }, 503);
    }

    async function callGemini(contents: unknown[], generationConfig?: Record<string, unknown>) {
      let lastError = "";
      for (const model of GEMINI_MODELS) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey!)}`,
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
            lastError = `Gemini API error (${res.status}) on ${model}`;
            console.warn(lastError);
            continue;
          }

          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (typeof text === "string" && text.trim().length > 0) {
            return { text: text.trim(), model };
          }
          lastError = `Empty response from model ${model}`;
        } catch (fetchErr) {
          clearTimeout(timeoutId);
          lastError = fetchErr instanceof Error ? fetchErr.message : "Unknown fetch error";
          console.warn(`Fetch error on ${model}: ${lastError}`);
          continue;
        }
      }
      throw new Error(lastError || "All Gemini fallback models failed");
    }

    // --- 4. Dispatch -------------------------------------------------------
    if (action === "swarm") {
      const staleError = marketDataAgeError(payload.dataTimestamp);
      if (staleError) {
        return json({ unavailable: true, error: staleError }, 422);
      }

      const symbol = normalizeSymbol(payload.symbol) ?? "BTCUSDT";
      const price = finiteNumber(payload.price, 0, 1e12) ?? 0;
      if (price <= 0) {
        return json({ unavailable: true, error: "A valid live price is required for a swarm debate." }, 422);
      }
      const rsi = finiteNumber(payload.rsi, 0, 100) ?? 50;
      const fearGreed = finiteNumber(payload.fearGreed, 0, 100) ?? 50;
      const confluenceScore = finiteNumber(payload.confluenceScore, 0, 100) ?? 50;
      const trend = clampString(payload.trend, 32) || "neutral";
      const patternName = clampString(payload.patternName, 64) || "Consolidation";
      const patternDirection = clampString(payload.patternDirection, 16) || "neutral";
      const atrValue = finiteNumber(payload.atrValue, 0, 1e12) ?? "N/A";
      const spreadPct = clampString(payload.spreadPct, 16) || "0.02%";

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
        const { text, model } = await callGemini([{ parts: [{ text: prompt }] }], {
          temperature: 0.3,
          maxOutputTokens: 600,
          responseMimeType: "application/json",
        });

        // Server-side schema validation: a malformed verdict is never forwarded as
        // if it were a usable trading recommendation.
        let validated: Record<string, unknown> | null = null;
        try {
          validated = validSwarmPayload(parseJsonResponse(text));
        } catch {
          validated = null;
        }
        if (!validated) {
          return json(
            { unavailable: true, error: "AI returned an invalid debate payload; verdict discarded." },
            502
          );
        }
        return json({ success: true, data: validated, modelUsed: model });
      } catch {
        return json({ unavailable: true, error: "Swarm debate is temporarily unavailable." }, 502);
      }
    }

    if (action === "explain") {
      const patternName = clampString(payload.patternName, 80);
      const coin = normalizeSymbol(payload.coin);
      const price = finiteNumber(payload.price, 0, 1e12);
      const direction = clampString(payload.direction, 16) || "bullish";
      const description = clampString(payload.description, 600);

      if (!patternName || !coin || price === null) {
        return json({ error: "Missing or invalid required fields: patternName, coin, price" }, 400);
      }

      const rawCandles = Array.isArray(payload.recentCandles) ? payload.recentCandles.slice(-15) : [];
      const candleSummary =
        rawCandles
          .map((c) => (c && typeof c === "object" ? finiteNumber((c as { close?: unknown }).close, 0, 1e12) : null))
          .filter((v): v is number => v !== null)
          .map((v) => v.toFixed(2))
          .join(", ") || "N/A";

      const prompt = `You are a Senior Quantitative Analyst & Pattern Specialist.
A technical pattern has been detected on ${coin}/USDT.
Pattern: ${patternName}
Direction: ${direction}
Description: ${description}
Current Price: $${price}
Recent Close Prices: ${candleSummary}

Produce a JSON response strictly matching this schema with NO markdown code fences:
{
  "explanation": "Pattern found: ${patternName} at $${price.toFixed(2)}. <concise summary>",
  "entry": <calculated numeric entry price>,
  "sl": <calculated numeric stop loss price>,
  "tp": <calculated numeric take profit price>,
  "reasoning": "<1-2 sentences explaining the institutional edge and invalidation conditions>"
}`;

      try {
        const { text, model } = await callGemini([{ parts: [{ text: prompt }] }], {
          temperature: 0.2,
          maxOutputTokens: 600,
          responseMimeType: "application/json",
        });

        const parsed = parseJsonResponse(text) as Record<string, unknown> | null;
        const levels = [parsed?.entry, parsed?.sl, parsed?.tp].map((v) => Number(v));
        const levelsValid =
          levels.every((v) => Number.isFinite(v) && v > 0) &&
          levels.every((v) => Math.abs(v - price) / price <= 0.5);
        if (!parsed || typeof parsed.explanation !== "string" || !levelsValid) {
          return json(
            { unavailable: true, error: "AI returned invalid price levels; analysis discarded." },
            502
          );
        }
        return json({ success: true, data: parsed, modelUsed: model });
      } catch {
        return json({ unavailable: true, error: "Pattern explanation is temporarily unavailable." }, 502);
      }
    }

    if (action === "vision") {
      const imageBase64 = typeof payload.imageBase64 === "string" ? payload.imageBase64 : "";
      const mimeType = clampString(payload.mimeType, 64) || "image/png";
      const activeSymbol = normalizeSymbol(payload.activeSymbol) ?? "BTCUSDT";

      if (!imageBase64) {
        return json({ error: "Missing required field: imageBase64" }, 400);
      }
      if (imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
        return json({ error: "Image too large. Please upload a chart under ~3 MB." }, 413);
      }
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(imageBase64)) {
        return json({ error: "imageBase64 is not valid base64 data" }, 400);
      }
      // `image/jpg` is not a registered MIME type but browsers do report it.
      const normalizedMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
      if (!/^image\/(png|jpeg|webp)$/.test(normalizedMime)) {
        return json({ error: "Unsupported image type" }, 415);
      }

      const prompt = `You are a Senior Crypto Technical Analyst & Vision AI specialized in reading candlestick charts, order books, SMC liquidity zones, and technical patterns.
Carefully examine this candlestick chart image for ${activeSymbol}.
Identify:
1. Trend: Overall trend ("Bullish", "Bearish", or "Sideways/Consolidation") with an explanation.
2. Support & Resistance: The key visible support levels/zones and resistance levels/zones.
3. Patterns: All visible chart patterns with direction ("bullish"|"bearish"|"neutral"), confidence (50-99), and description.
4. Key Takeaway: Concise trading recommendation, suggested action ("LONG"|"SHORT"|"WAIT"), and invalidation/stop-loss level.

Respond STRICTLY in valid JSON matching this schema:
{
  "trend": "Bullish" | "Bearish" | "Sideways/Consolidation",
  "trendReason": "Brief explanation of price structure",
  "supportResistance": { "support": ["Level 1"], "resistance": ["Level 1"] },
  "patterns": [{ "name": "Pattern Name", "direction": "bullish", "confidence": 85, "description": "Details" }],
  "suggestedAction": "LONG" | "SHORT" | "WAIT",
  "invalidationLevel": "Price level that invalidates this setup",
  "keyTakeaway": "1-2 sentence actionable summary."
}`;

      try {
        const { text, model } = await callGemini(
          [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: normalizedMime, data: imageBase64 } },
              ],
            },
          ],
          { temperature: 0.2, maxOutputTokens: 800, responseMimeType: "application/json" }
        );
        // Server-side schema check: a malformed vision payload is discarded here
        // rather than handed to the client as if it were a real analysis.
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = parseJsonResponse(text) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
        const trend = typeof parsed?.trend === "string" ? parsed.trend : "";
        const validTrend = ["Bullish", "Bearish", "Sideways/Consolidation"].includes(trend);
        const validPatterns = Array.isArray(parsed?.patterns);
        if (!parsed || !validTrend || !validPatterns) {
          return json(
            { unavailable: true, error: "AI returned an invalid chart analysis; result discarded." },
            502
          );
        }
        return json({ success: true, data: parsed, modelUsed: model });
      } catch {
        return json({ unavailable: true, error: "Vision analysis is temporarily unavailable." }, 502);
      }
    }

    // Default: conversational chat
    const message = clampString(payload.message, MAX_MESSAGE_CHARS);
    if (!message) {
      return json({ error: "Missing required field: message" }, 400);
    }

    // Chat is allowed to run without a symbol context, but if a context timestamp is
    // supplied it must be fresh; stale snapshots are never described as live.
    if (payload.dataTimestamp !== undefined && payload.dataTimestamp !== null) {
      const staleError = marketDataAgeError(payload.dataTimestamp);
      if (staleError) {
        return json({ unavailable: true, error: staleError }, 422);
      }
    }

    const context = payload.marketContext;
    const contextStr =
      context && typeof context === "object"
        ? `Current market context:
- Coin: ${normalizeSymbol((context as Record<string, unknown>).coin) ?? "N/A"}
- Price: ${clampString((context as Record<string, unknown>).price, 24) || "N/A"}
- 24h Change: ${clampString((context as Record<string, unknown>).change24h, 24) || "N/A"}
- RSI: ${clampString((context as Record<string, unknown>).rsi, 12) || "N/A"}
- Trend: ${clampString((context as Record<string, unknown>).trend, 24) || "N/A"}
- Detected Pattern: ${clampString((context as Record<string, unknown>).pattern, 64) || "None"}
- Fear & Greed Index: ${clampString((context as Record<string, unknown>).fearGreed, 12) || "N/A"}`
        : "";

    const history = Array.isArray(payload.conversationHistory)
      ? payload.conversationHistory.slice(-MAX_HISTORY_ITEMS)
      : [];
    const historyStr = history.length
      ? "Previous conversation:\n" +
        history
          .map((item) => {
            if (!item || typeof item !== "object") return "";
            const role = clampString((item as Record<string, unknown>).role, 16) === "assistant" ? "assistant" : "user";
            return `${role}: ${clampString((item as Record<string, unknown>).content, 600)}`;
          })
          .filter(Boolean)
          .join("\n")
      : "";

    const systemPrompt = `You are PatternHunter AI, an expert cryptocurrency trading assistant integrated into a real-time crypto pattern detection app.
You help users understand market conditions, analyze patterns, and make informed trading decisions.

${contextStr}

${historyStr}

Guidelines:
- Be concise but thorough. Use clear, professional language.
- When users ask to "show" or "display" a coin chart, respond with: [ACTION:show_chart:SYMBOL].
- Trading guidance is educational, never financial advice. Always include a disclaimer for trade-related questions.
- Keep responses under 150 words unless the user asks for detail.
- Use plain text with line breaks, no markdown headers.`;

    try {
      const { text, model } = await callGemini(
        [{ parts: [{ text: `${systemPrompt}\n\nUser: ${message}\n\nPatternHunter AI:` }] }],
        { temperature: 0.6, maxOutputTokens: 500 }
      );
      return json({ response: text, modelUsed: model });
    } catch {
      return json({ unavailable: true, error: "AI assistant is temporarily unavailable." }, 502);
    }
  } catch (err) {
    console.error("[ai-chat] unexpected error:", err instanceof Error ? err.message : err);
    return json({ unavailable: true, error: "AI service internal error" }, 500);
  }
});
