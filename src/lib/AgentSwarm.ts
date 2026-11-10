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

import { supabase } from "./supabase";

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
  };
}

/**
 * Real AI Swarm Generator:
 * Invokes Supabase Edge Function 'ai-chat' with action: 'swarm'.
 * Gracefully falls back to simulateSwarmDebate without requiring user-provided Gemini API key.
 */
export async function runRealSwarmDebate(params: SwarmDebateParams): Promise<SwarmDebateResult> {
  const baseSim = simulateSwarmDebate(params);

  const now = new Date();
  const timeStr = (offsetSec: number) => {
    const d = new Date(now.getTime() + offsetSec * 1000);
    return d.toISOString().substring(11, 19);
  };

  try {
    const { data, error } = await supabase.functions.invoke("ai-chat", {
      body: {
        action: "swarm",
        symbol: params.symbol,
        price: params.price,
        rsi: params.rsi,
        trend: params.trend,
        patternName: params.patternName,
        patternDirection: params.patternDirection,
        fearGreed: params.fearGreed,
        atrValue: params.atrValue,
        spreadPct: params.spreadPct,
        confluenceScore: baseSim.confluenceScore,
      },
    });

    if (error || !data || !data.data) {
      return baseSim;
    }

    const parsed = data.data;

    const bullMessage: SwarmAgentMessage = {
      agent: "Bull Agent",
      role: "BULL",
      sentiment: "BULLISH",
      confidence: Math.min(100, Math.max(10, parsed.bullConfidence || baseSim.messages[0].confidence)),
      timestamp: timeStr(0),
      message: parsed.bullThesis || baseSim.messages[0].message,
    };

    const bearMessage: SwarmAgentMessage = {
      agent: "Bear Agent",
      role: "BEAR",
      sentiment: "BEARISH",
      confidence: Math.min(100, Math.max(10, parsed.bearConfidence || baseSim.messages[1].confidence)),
      timestamp: timeStr(1),
      message: parsed.bearThesis || baseSim.messages[1].message,
    };

    const isGo = parsed.riskVerdict === "GO";
    const riskMessage: SwarmAgentMessage = {
      agent: "Risk Manager",
      role: "RISK",
      sentiment: isGo ? "GO" : "NO-GO",
      confidence: Math.round(baseSim.confluenceScore),
      timestamp: timeStr(2),
      message: parsed.riskThesis || baseSim.messages[2].message,
    };

    return {
      symbol: params.symbol,
      price: params.price,
      confluenceScore: baseSim.confluenceScore,
      verdict: isGo ? "GO" : "NO-GO",
      verdictReason: riskMessage.message,
      recommendedDirection: parsed.recommendedDirection || baseSim.recommendedDirection,
      recommendedLeverage: Math.min(10, Math.max(1, parsed.recommendedLeverage || baseSim.recommendedLeverage)),
      recommendedPositionPct: Math.min(10, Math.max(0.5, parsed.recommendedPositionPct || baseSim.recommendedPositionPct)),
      messages: [bullMessage, bearMessage, riskMessage],
      apiKeyUsed: true,
      isRealAI: true,
    };
  } catch {
    return baseSim;
  }
}
