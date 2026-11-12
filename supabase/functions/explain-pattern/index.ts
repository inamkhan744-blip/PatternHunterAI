/**
 * explain-pattern — focused pattern narrative generator.
 *
 * Security controls: JWT required, per-user rate limiting (10/min, 120/hour),
 * strict numeric/string validation, no upstream error leakage.
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

const GEMINI_TIMEOUT_MS = 20000;
const GEMINI_MODELS = ["gemini-1.5-flash", "gemini-2.0-flash"];

function stripMarkdown(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/g, "")
    .replace(/```json\n?|```/g, "")
    .trim();
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

    const perMinute = await enforceRateLimit(auth.user.id, "explain-pattern:min", 10, 60);
    if (!perMinute) {
      return json({ error: "Rate limit exceeded (10 requests/minute)." }, 429);
    }
    const perHour = await enforceRateLimit(auth.user.id, "explain-pattern:hour", 120, 3600);
    if (!perHour) {
      return json({ error: "Hourly limit reached (120/hour)." }, 429);
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const patternName = clampString(payload.patternName, 80);
    const coin = normalizeSymbol(payload.coin);
    const direction = clampString(payload.direction, 16) || "bullish";
    const description = clampString(payload.description, 600);
    const price = finiteNumber(payload.price, 0, 1e12);

    if (!patternName || !coin || price === null) {
      return json({ error: "Missing or invalid required fields: patternName, coin, price" }, 400);
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return json({ unavailable: true, error: "Backend GEMINI_API_KEY is not configured." }, 503);
    }

    const candles = Array.isArray(payload.recentCandles) ? payload.recentCandles.slice(-15) : [];
    const candleSummary =
      candles
        .map((c) => (c && typeof c === "object" ? finiteNumber((c as { close?: unknown }).close, 0, 1e12) : null))
        .filter((v): v is number => v !== null)
        .map((v) => v.toFixed(2))
        .join(", ") || "N/A";

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
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`,
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
        if (typeof text === "string" && text.trim().length > 0) {
          geminiText = text.trim();
          break;
        }
        lastError = `Empty response from model ${model}`;
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        lastError =
          fetchErr instanceof DOMException && fetchErr.name === "AbortError"
            ? `Request to ${model} timed out`
            : fetchErr instanceof Error
              ? fetchErr.message
              : "Unknown fetch error";
        console.warn(`[explain-pattern] ${lastError}`);
        continue;
      }
    }

    if (geminiText) {
      return json({ explanation: stripMarkdown(geminiText) });
    }

    return json({ unavailable: true, error: "AI analysis unavailable" }, 503);
  } catch (err) {
    console.error("[explain-pattern] unexpected error:", err instanceof Error ? err.message : err);
    return json({ unavailable: true, error: "AI service internal error" }, 500);
  }
});
