import type { DetectedPattern, PatternType } from "../types";

interface PatternProfile {
  entryOffset: number;
  slOffset: number;
  tpOffset: number;
  bias: "long" | "short";
  reasoning: string;
}

const DEFAULT_PROFILE: PatternProfile = {
  entryOffset: 0.002,
  slOffset: -0.01,
  tpOffset: 0.02,
  bias: "long",
  reasoning: "Chart pattern price action projection based on support/resistance and momentum.",
};

const PROFILES: Partial<Record<PatternType, PatternProfile>> = {
  double_top: {
    entryOffset: -0.003, slOffset: 0.01, tpOffset: -0.02, bias: "short",
    reasoning: "Double Top confirms bearish reversal — two failed attempts to break resistance signal selling pressure.",
  },
  double_bottom: {
    entryOffset: 0.003, slOffset: -0.01, tpOffset: 0.02, bias: "long",
    reasoning: "Double Bottom confirms bullish reversal — two failed attempts to break support signal accumulating buying interest.",
  },
  triple_top: {
    entryOffset: -0.004, slOffset: 0.012, tpOffset: -0.025, bias: "short",
    reasoning: "Triple Top confirms major distribution ceiling with buyer exhaustion.",
  },
  triple_bottom: {
    entryOffset: 0.004, slOffset: -0.012, tpOffset: 0.025, bias: "long",
    reasoning: "Triple Bottom confirms strong institutional demand accumulation base.",
  },
  ma_crossover_bull: {
    entryOffset: 0.002, slOffset: -0.008, tpOffset: 0.015, bias: "long",
    reasoning: "Golden Cross — short-term momentum crossed above the longer-term trend, signaling upward continuation.",
  },
  ma_crossover_bear: {
    entryOffset: -0.002, slOffset: 0.008, tpOffset: -0.015, bias: "short",
    reasoning: "Death Cross — short-term momentum crossed below the longer-term trend, signaling downward continuation.",
  },
  head_and_shoulders: {
    entryOffset: -0.005, slOffset: 0.012, tpOffset: -0.03, bias: "short",
    reasoning: "Head and Shoulders — the head failed to sustain higher highs while shoulders weakened, a classic bearish reversal.",
  },
  inverse_head_and_shoulders: {
    entryOffset: 0.005, slOffset: -0.012, tpOffset: 0.03, bias: "long",
    reasoning: "Inverse Head and Shoulders — the head held a higher low while shoulders rose, a classic bullish reversal.",
  },
  bull_flag: {
    entryOffset: 0.002, slOffset: -0.01, tpOffset: 0.03, bias: "long",
    reasoning: "Bull Flag — a sharp pole followed by tight downward-sloping consolidation typically resolves upward.",
  },
  bear_flag: {
    entryOffset: -0.002, slOffset: 0.01, tpOffset: -0.03, bias: "short",
    reasoning: "Bear Flag — a sharp drop followed by tight upward-sloping consolidation typically resolves downward.",
  },
  ascending_triangle: {
    entryOffset: 0.002, slOffset: -0.008, tpOffset: 0.025, bias: "long",
    reasoning: "Ascending Triangle — flat resistance with rising support shows buyers stepping in; breakout expected upward.",
  },
  descending_triangle: {
    entryOffset: -0.002, slOffset: 0.008, tpOffset: -0.025, bias: "short",
    reasoning: "Descending Triangle — flat support with falling resistance shows sellers pressing down; breakout expected downward.",
  },
  symmetrical_triangle: {
    entryOffset: 0.002, slOffset: -0.01, tpOffset: 0.02, bias: "long",
    reasoning: "Symmetrical Triangle — volatility contraction squeezing towards breakout expansion.",
  },
  cup_and_handle: {
    entryOffset: 0.003, slOffset: -0.01, tpOffset: 0.035, bias: "long",
    reasoning: "Cup and Handle — rounded accumulation bottom followed by a shallow handle; bullish continuation likely.",
  },
  rising_wedge: {
    entryOffset: -0.003, slOffset: 0.012, tpOffset: -0.025, bias: "short",
    reasoning: "Rising Wedge — converging upward trendlines squeeze momentum; bearish breakout increasingly likely.",
  },
  falling_wedge: {
    entryOffset: 0.003, slOffset: -0.012, tpOffset: 0.025, bias: "long",
    reasoning: "Falling Wedge — converging downward trendlines squeeze momentum; bullish breakout increasingly likely.",
  },
  bullish_engulfing: {
    entryOffset: 0.001, slOffset: -0.01, tpOffset: 0.025, bias: "long",
    reasoning: "Bullish Engulfing — strong buyer candle swallowed previous selling pressure completely.",
  },
  bearish_engulfing: {
    entryOffset: -0.001, slOffset: 0.01, tpOffset: -0.025, bias: "short",
    reasoning: "Bearish Engulfing — aggressive selling candle swallowed previous buying pressure completely.",
  },
  hammer: {
    entryOffset: 0.001, slOffset: -0.01, tpOffset: 0.02, bias: "long",
    reasoning: "Hammer pinbar — long lower shadow rejected cheaper liquidity.",
  },
  shooting_star: {
    entryOffset: -0.001, slOffset: 0.01, tpOffset: -0.02, bias: "short",
    reasoning: "Shooting star — long upper shadow rejected high prices.",
  },
  liquidity_sweep_bull: {
    entryOffset: 0.002, slOffset: -0.012, tpOffset: 0.03, bias: "long",
    reasoning: "Turtle soup sweep below key floor reclaimed with high absorption.",
  },
  liquidity_sweep_bear: {
    entryOffset: -0.002, slOffset: 0.012, tpOffset: -0.03, bias: "short",
    reasoning: "Buy stop run above key ceiling rejected back into range.",
  },
  breakout_bull: {
    entryOffset: 0.003, slOffset: -0.01, tpOffset: 0.03, bias: "long",
    reasoning: "Range ceiling expansion with continuation momentum.",
  },
  breakout_bear: {
    entryOffset: -0.003, slOffset: 0.01, tpOffset: -0.03, bias: "short",
    reasoning: "Range floor breakdown with downside continuation momentum.",
  },
};

export function generateFallbackAnalysis(pattern: DetectedPattern, coin: string, price: number): string {
  const profile = PROFILES[pattern.type] ?? DEFAULT_PROFILE;
  const entry = price * (1 + profile.entryOffset);
  const sl = price * (1 + profile.slOffset);
  const tp = price * (1 + profile.tpOffset);

  const fmt = (v: number) =>
    v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v.toFixed(2);

  return `Pattern found: ${pattern.name} at ${fmt(price)}. ${
    profile.bias === "short" ? "Expect a reversal to the downside." : "Expect a reversal to the upside."
  }
Entry: ${fmt(entry)}
SL: ${fmt(sl)}
TP: ${fmt(tp)}
Reasoning: ${profile.reasoning} ${pattern.description}. Automated estimate — AI analysis was unavailable, so levels are calculated from standard pattern projections for ${coin}/USDT.`;
}

export function parseAnalysisPrices(explanation: string): { entry: number; sl: number; tp: number } | null {
  const entryMatch = explanation.match(/Entry:\s*\$?([\d,.]+)/i);
  const slMatch = explanation.match(/SL:\s*\$?([\d,.]+)/i);
  const tpMatch = explanation.match(/TP:\s*\$?([\d,.]+)/i);
  if (!entryMatch || !slMatch || !tpMatch) return null;
  const parseVal = (s: string) => parseFloat(s.replace(/,/g, ""));
  const entry = parseVal(entryMatch[1]);
  const sl = parseVal(slMatch[1]);
  const tp = parseVal(tpMatch[1]);
  if (isNaN(entry) || isNaN(sl) || isNaN(tp)) return null;
  return { entry, sl, tp };
}

export function getFallbackPrices(pattern: DetectedPattern, price: number): { entry: number; sl: number; tp: number } {
  const profile = PROFILES[pattern.type] ?? DEFAULT_PROFILE;
  return {
    entry: price * (1 + profile.entryOffset),
    sl: price * (1 + profile.slOffset),
    tp: price * (1 + profile.tpOffset),
  };
}
