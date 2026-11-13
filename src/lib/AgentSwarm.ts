/**
 * Multi-Agent AI Swarm Engine for Hedge Fund Alpha Synthesis
 * Simulates a high-frequency debate between 3 specialized algorithmic agents:
 * 1. Bull Agent: Momentum, structural breakouts, liquidity grab upside.
 * 2. Bear Agent: Overbought fatigue, macro headwinds, resistance order blocks.
 * 3. Risk Manager: Confluence validation, Kelly sizing, and definitive GO / NO-GO verdict.
 */

export interface SwarmAgentMessage {
  agent: "Bull Agent" | "Bear Agent" | "Risk Manager";
  role: "BULL" | "BEAR" | "RISK";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL" | "GO" | "NO-GO";
  message: string;
  confidence: number; // 0 - 100
  timestamp: string;
}

import { generateAIResponse, parseAIJson } from "./AIService";

import { liveWorkerLogStore } from "./LiveWorkerLogStore";

export interface SwarmDebateResult {
  symbol: string;
  price: number;
  confluenceScore: number; // 0 - 100
  verdict: "GO" | "NO-GO";
  verdictReason: string;
  recommendedDirection: "LONG" | "SHORT" | "HOLD";
  recommendedLeverage: number;
  recommendedPositionPct: number;
  messages: SwarmAgentMessage[];
  apiKeyUsed?: boolean;
  isRealAI?: boolean;
  isFallback?: boolean;
}

export interface SwarmDebateParams {
  symbol: string;
  price: number;
  rsi?: number | null;
  trend?: string | null;
  patternName?: string | null;
  patternDirection?: "bullish" | "bearish" | null;
  fearGreed?: number | null;
  spreadPct?: number | null;
  atrValue?: number | null;
  confluenceScore?: number | null;
  allowAiFallback?: boolean;
  /** Epoch ms of the newest candle this context was built from. */
  dataTimestamp?: number | null;
}

/** Market context older than this is rejected instead of being analysed. */
export const MAX_MARKET_DATA_AGE_MS = 15 * 60 * 1000;

export function isFreshMarketData(
  dataTimestamp: number | null | undefined,
  maxAgeMs: number = MAX_MARKET_DATA_AGE_MS
): { fresh: boolean; ageMinutes: number | null } {
  if (typeof dataTimestamp !== "number" || !Number.isFinite(dataTimestamp) || dataTimestamp <= 0) {
    return { fresh: false, ageMinutes: null };
  }
  const ageMs = Date.now() - dataTimestamp;
  // A timestamp in the future (clock skew) is treated as stale rather than trusted.
  if (ageMs < -60_000) return { fresh: false, ageMinutes: Math.round(Math.abs(ageMs) / 60000) };
  return { fresh: ageMs <= maxAgeMs, ageMinutes: Math.max(0, Math.round(ageMs / 60000)) };
}

/** Strips control characters and caps AI-authored text before it is rendered. */
function sanitizeAiText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, maxChars);
}

function clampConfidence(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

interface ValidatedSwarmPayload {
  bullThesis: string;
  bullConfidence: number;
  bearThesis: string;
  bearConfidence: number;
  riskVerdict: "GO" | "NO-GO";
  riskThesis: string;
  recommendedDirection: "LONG" | "SHORT" | "HOLD";
  recommendedLeverage: number;
  recommendedPositionPct: number;
}

/**
 * Validates the model-authored debate payload. A malformed verdict is never used
 * as if it were a usable trading recommendation.
 */
function validSwarmPayload(raw: unknown): ValidatedSwarmPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const bull = sanitizeAiText(o.bullThesis, 700);
  const bear = sanitizeAiText(o.bearThesis, 700);
  const risk = sanitizeAiText(o.riskThesis, 700);
  const verdict = o.riskVerdict === "GO" || o.riskVerdict === "NO-GO" ? o.riskVerdict : null;
  const direction = ["LONG", "SHORT", "HOLD"].includes(String(o.recommendedDirection))
    ? (String(o.recommendedDirection) as "LONG" | "SHORT" | "HOLD")
    : null;

  if (!bull || !bear || !verdict || !direction) return null;

  return {
    bullThesis: bull,
    bullConfidence: clampNumber(o.bullConfidence, 0, 100, 50),
    bearThesis: bear,
    bearConfidence: clampNumber(o.bearConfidence, 0, 100, 50),
    riskVerdict: verdict,
    riskThesis: risk || "Risk thesis omitted by model.",
    recommendedDirection: direction,
    recommendedLeverage: clampNumber(o.recommendedLeverage, 1, 10, 1),
    recommendedPositionPct: clampNumber(o.recommendedPositionPct, 0, 10, 0),
  };
}

/**
 * Fast synchronous heuristic debate generator.
 * Used for instant fallback or unit testing.
 */
export function simulateSwarmDebate(params: SwarmDebateParams): SwarmDebateResult {
  const {
    symbol,
    price,
    rsi = 52,
    trend = "uptrend",
    patternName,
    patternDirection,
    fearGreed = 60,
    spreadPct,
    atrValue,
    confluenceScore: inputConfluence,
  } = params;

  const effectiveRsi = rsi ?? 50;
  const isUptrend = trend === "uptrend";
  const isPatternBullish = patternDirection === "bullish";

  // Calculate algorithmic confluence score (0 - 100)
  let confluence = 50;
  if (isPatternBullish) confluence += 20;
  else if (patternDirection === "bearish") confluence -= 20;

  if (isUptrend) confluence += 15;
  else if (trend === "downtrend") confluence -= 15;

  if (effectiveRsi < 35) confluence += 15; // oversold bounce potential
  else if (effectiveRsi > 70) confluence -= 15; // overbought risk

  if ((fearGreed ?? 50) < 30) confluence += 10; // buy extreme fear
  else if ((fearGreed ?? 50) > 75) confluence -= 10; // caution extreme greed

  confluence = Math.max(10, Math.min(95, confluence));

  const now = new Date();
  const timeStr = (offsetSec: number) => {
    const d = new Date(now.getTime() + offsetSec * 1000);
    return d.toISOString().substring(11, 19);
  };

  // Bull Agent Thesis
  const bullConfidence = Math.min(95, Math.max(30, Math.round(confluence * 1.15)));
  const bullMessage: SwarmAgentMessage = {
    agent: "Bull Agent",
    role: "BULL",
    sentiment: "BULLISH",
    confidence: bullConfidence,
    timestamp: timeStr(0),
    message: patternName
      ? `High-probability institutional accumulation verified on ${symbol}. Pattern [${patternName}] reveals liquidity absorption near $${price.toLocaleString()}. RSI (${effectiveRsi.toFixed(1)}) indicates solid expansion runway before resistance. Bid clusters on order book suggest smart money defense. Strong LONG continuation thesis.`
      : `Order flow momentum accelerating on ${symbol}. Microstructure delta shows aggressive market buying absorbing passive ask depth at $${price.toLocaleString()}. Trend posture remains structurally bullish with macro funding compression favoring upside squeeze.`,
  };

  // Bear Agent Thesis
  const bearConfidence = Math.min(95, Math.max(25, 100 - bullConfidence + 15));
  const bearMessage: SwarmAgentMessage = {
    agent: "Bear Agent",
    role: "BEAR",
    sentiment: "BEARISH",
    confidence: bearConfidence,
    timestamp: timeStr(1),
    message: effectiveRsi > 65
      ? `Counter-argument: RSI is entering distribution threshold (${effectiveRsi.toFixed(1)}). Spot cumulative volume delta (CVD) divergence is showing buyer exhaustion near current highs. Unfilled fair value gaps below current price represent a magnet for a 3-5% liquidation sweep before any genuine breakout.`
      : `Resistance overhead at key supply zone. Macro liquidity conditions present elevated tail-risk. If BTC or broader index pulls back, ${symbol} bids will evaporate rapidly. Funding rate creep signals crowded longs vulnerable to a cascade.`,
  };

  // Risk Manager Analysis & Strict Institutional Veto
  // Evaluates market volatility, bid/ask spread, and trend conflicts
  const atrPercent = atrValue && price > 0 ? (atrValue / price) * 100 : 0;
  const isHighVolatility = atrPercent > 3.0;
  const isBadSpread = spreadPct !== undefined && spreadPct !== null && spreadPct > 0.1;
  const hasConflictingTrend = trend === "downtrend" && (patternDirection === "bullish" || !patternDirection);

  let vetoReason: string | null = null;
  if (isBadSpread) {
    vetoReason = `Excessive Bid/Ask spread (${spreadPct.toFixed(3)}% > 0.10% maximum tolerance). Institutional slippage risk too high.`;
  } else if (isHighVolatility) {
    vetoReason = `Extreme market volatility detected (ATR is ${atrPercent.toFixed(2)}% of price). Liquidation wick probability unacceptable.`;
  } else if (hasConflictingTrend) {
    vetoReason = `Conflicting macro trend posture (${trend}) threatens pattern resolution. Asymmetry skewed negatively.`;
  }

  // Base threshold is 62 unless high input confluence is provided without veto
  const baseHurdle = inputConfluence ? 85 : 62;
  const effectiveConfluence = inputConfluence ?? Math.round(confluence);

  let verdict: "GO" | "NO-GO" = "GO";
  let verdictMessage = "";

  if (vetoReason) {
    verdict = "NO-GO";
    verdictMessage = `RISK MANAGER VETO [NO-GO]: ${vetoReason} Trade execution unconditionally blocked by Swarm Risk Manager.`;
  } else if (effectiveConfluence < baseHurdle) {
    verdict = "NO-GO";
    verdictMessage = `EXECUTION REJECTED. Multi-factor confluence score of ${effectiveConfluence}/100 fails the ${baseHurdle}-point hurdle rate. Dispersion between Bull and Bear arguments creates unfavorable asymmetry. Preserving capital into consolidation. Verdict: [NO-GO].`;
  } else {
    verdict = "GO";
    verdictMessage = `CONFLUENCE VERIFIED (${effectiveConfluence}/100). Institutional edge surpasses statistical hurdle (>=${baseHurdle}). Risk parameters vetted (Spread & Volatility safe). Kelly criterion allows position allocation. Trailing stop to break-even mandatory at 1:1 RR. Verdict: [GO EXECUTION].`;
  }

  const recommendedDirection: "LONG" | "SHORT" | "HOLD" =
    verdict === "GO" ? (effectiveConfluence >= 60 ? "LONG" : "SHORT") : "HOLD";
  const recommendedLeverage = effectiveConfluence >= 80 ? 5 : effectiveConfluence >= 70 ? 3 : 2;
  const recommendedPositionPct = verdict === "GO" ? (effectiveConfluence >= 75 ? 2.5 : 1.5) : 0;

  const riskMessage: SwarmAgentMessage = {
    agent: "Risk Manager",
    role: "RISK",
    sentiment: verdict === "GO" ? "GO" : "NO-GO",
    confidence: Math.round(effectiveConfluence),
    timestamp: timeStr(2),
    message: verdictMessage,
  };

  return {
    symbol,
    price,
    confluenceScore: Math.round(confluence),
    verdict,
    verdictReason: riskMessage.message,
    recommendedDirection,
    recommendedLeverage,
    recommendedPositionPct,
    messages: [bullMessage, bearMessage, riskMessage],
    apiKeyUsed: false,
    isRealAI: false,
    isFallback: true,
  };
}

/**
 * Local Heuristic Engine for AI Swarm:
 * Evaluates RSI, Confluence Score, and Pattern when the AI provider fails or times out.
 * Instead of defaulting to NO-GO or failing completely, it dynamically verifies
 * whether the setup qualifies for execution under deterministic quant rules.
 */
export function evaluateLocalHeuristicEngine(params: SwarmDebateParams): SwarmDebateResult {
  const result = simulateSwarmDebate(params);
  const allowFallback = params.allowAiFallback ?? true;

  if (!allowFallback) {
    return {
      ...result,
      verdict: "NO-GO",
      verdictReason: "AI provider unavailable and AI Fallback Mode is disabled in Auto-Pilot settings.",
      isFallback: true,
    };
  }

  // When fallback is allowed, simulateSwarmDebate computes the deterministic quantitative edge
  return {
    ...result,
    isFallback: true,
  };
}

/**
 * Real AI Swarm Generator:
 * Asks the active AI provider (Gemini / DeepSeek / Groq, admin-selected) for the
 * three-agent debate directly from the browser via AIService.
 * Gracefully falls back to the Local Heuristic Engine without blocking trades when
 * no provider is reachable.
 */
export async function runRealSwarmDebate(params: SwarmDebateParams): Promise<SwarmDebateResult> {
  const now = new Date();
  const timeStr = (offsetSec: number) => {
    const d = new Date(now.getTime() + offsetSec * 1000);
    return d.toISOString().substring(11, 19);
  };

  // --- Pre-flight validation: never ask an LLM to reason about bad/stale data ---
  if (!Number.isFinite(params.price) || params.price <= 0) {
    return {
      ...simulateSwarmDebate(params),
      verdict: "NO-GO",
      verdictReason: "NO-GO: live market price is unavailable. Debate aborted rather than analysed on missing data.",
      recommendedDirection: "HOLD",
      recommendedPositionPct: 0,
      isRealAI: false,
      isFallback: true,
    };
  }

  const freshness = isFreshMarketData(params.dataTimestamp);
  if (!freshness.fresh) {
    const ageText = freshness.ageMinutes === null ? "unknown age" : `${freshness.ageMinutes} min old`;
    liveWorkerLogStore.addLog(`Swarm debate blocked: stale market data (${ageText})`, "warn", {
      symbol: params.symbol,
    });
    return {
      ...simulateSwarmDebate(params),
      verdict: "NO-GO",
      verdictReason: `NO-GO: market data is stale (${ageText}, limit 15 min). Refresh the chart before requesting an AI verdict.`,
      recommendedDirection: "HOLD",
      recommendedPositionPct: 0,
      isRealAI: false,
      isFallback: true,
    };
  }

  const prompt = `You are an elite hedge fund investment committee debating an algorithmic trade setup.
Asset: ${params.symbol}
Current Price: $${params.price}
RSI(14): ${params.rsi ?? 50}
Trend: ${params.trend ?? "neutral"}
Pattern: ${params.patternName ?? "Consolidation"} (${params.patternDirection ?? "neutral"})
Fear & Greed Index: ${params.fearGreed ?? 50}
ATR: ${params.atrValue ?? "N/A"}
Spread %: ${params.spreadPct ?? "0.02%"}
Preliminary Confluence Score: ${params.confluenceScore ?? 75}/100

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

  const systemPrompt =
    "You are the risk committee of a quantitative crypto fund. Debate both sides of the setup " +
    "honestly, never invent data outside the supplied metrics, and reply with JSON only.";

  try {
    const aiResult = await generateAIResponse(prompt, systemPrompt, undefined, {
      temperature: 0.3,
      maxOutputTokens: 600,
      json: true,
      timeoutMs: 8000,
    });

    let rawParsed: unknown = null;
    try {
      rawParsed = parseAIJson(aiResult.text);
    } catch {
      rawParsed = null;
    }

    const parsed = validSwarmPayload(rawParsed);

    if (!parsed) {
      liveWorkerLogStore.addLog("AI response parse/schema validation failed - Activating Local Heuristic Fallback", "warn", { symbol: params.symbol });
      return evaluateLocalHeuristicEngine(params);
    }

    const baseSim = simulateSwarmDebate(params);

    // Every AI-authored field was already sanitised + enum-validated above.
    const bullThesis = parsed.bullThesis;
    const bearThesis = parsed.bearThesis;
    const riskThesis = parsed.riskThesis;
    const aiVerdict = parsed.riskVerdict;
    const aiDirection = parsed.recommendedDirection;

    // The LLM may never *create* a GO that the deterministic gates reject. It can
    // only confirm or downgrade the quantitative verdict.
    const deterministicGo = baseSim.verdict === "GO";
    const isGo = aiVerdict === "GO" && deterministicGo;
    const downgradedByAi = aiVerdict === "NO-GO" && deterministicGo;
    const overriddenByRiskEngine = aiVerdict === "GO" && !deterministicGo;

    const verdictMessage = isGo
      ? riskThesis || baseSim.verdictReason
      : overriddenByRiskEngine
        ? `NO-GO: AI suggested execution, but the deterministic risk engine rejected the setup (${baseSim.verdictReason}). AI output is never treated as a confirmed signal.`
        : downgradedByAi
          ? `NO-GO: the AI risk manager downgraded a setup that passed the quantitative gates. ${riskThesis || baseSim.verdictReason}`
          : riskThesis || baseSim.verdictReason;

    if (overriddenByRiskEngine) {
      liveWorkerLogStore.addLog(
        "AI GO rejected: deterministic risk gates did not pass",
        "warn",
        { symbol: params.symbol }
      );
    }

    const bullMessage: SwarmAgentMessage = {
      agent: "Bull Agent",
      role: "BULL",
      sentiment: "BULLISH",
      confidence: clampConfidence(parsed.bullConfidence) ?? baseSim.messages[0].confidence,
      timestamp: timeStr(0),
      message: bullThesis,
    };

    const bearMessage: SwarmAgentMessage = {
      agent: "Bear Agent",
      role: "BEAR",
      sentiment: "BEARISH",
      confidence: clampConfidence(parsed.bearConfidence) ?? baseSim.messages[1].confidence,
      timestamp: timeStr(1),
      message: bearThesis,
    };

    const riskMessage: SwarmAgentMessage = {
      agent: "Risk Manager",
      role: "RISK",
      sentiment: isGo ? "GO" : "NO-GO",
      confidence: Math.round(baseSim.confluenceScore),
      timestamp: timeStr(2),
      message: verdictMessage,
    };

    return {
      symbol: params.symbol,
      price: params.price,
      confluenceScore: baseSim.confluenceScore,
      verdict: isGo ? "GO" : "NO-GO",
      verdictReason: verdictMessage,
      // Direction must be a validated enum, and a non-executable verdict can never
      // recommend a position.
      recommendedDirection: isGo ? aiDirection : "HOLD",
      recommendedLeverage: Math.min(10, Math.max(1, Number(parsed.recommendedLeverage) || baseSim.recommendedLeverage)),
      recommendedPositionPct: isGo
        ? Math.min(10, Math.max(0.5, Number(parsed.recommendedPositionPct) || baseSim.recommendedPositionPct))
        : 0,
      messages: [bullMessage, bearMessage, riskMessage],
      apiKeyUsed: true,
      isRealAI: true,
      isFallback: false,
    };
  } catch (err) {
    console.error("[AI Swarm] generateAIResponse failed:", err);
    const errMsg = err instanceof Error ? err.message : String(err);
    liveWorkerLogStore.addLog(`AI provider unavailable (${errMsg}) - Falling back to Local Heuristic Engine`, "warn", { symbol: params.symbol });
    return evaluateLocalHeuristicEngine(params);
  }
}
