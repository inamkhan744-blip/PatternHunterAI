export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type PatternType =
  | "double_top"
  | "double_bottom"
  | "ma_crossover_bull"
  | "ma_crossover_bear"
  | "head_and_shoulders"
  | "inverse_head_and_shoulders"
  | "bull_flag"
  | "bear_flag"
  | "ascending_triangle"
  | "descending_triangle"
  | "cup_and_handle"
  | "rising_wedge"
  | "falling_wedge";

export interface PatternPoint {
  time: number;
  price: number;
}

export interface PatternLine {
  points: PatternPoint[];
  color?: string;
}

export interface DetectedPattern {
  type: PatternType;
  name: string;
  description: string;
  points: PatternPoint[];
  lines?: PatternLine[];
  direction: "bullish" | "bearish";
}

export interface Coin {
  symbol: string;
  label: string;
  binanceSymbol: string;
}

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1W";

export interface ScanResult {
  symbol: string;
  label: string;
  binanceSymbol: string;
  pattern: DetectedPattern;
  price: number;
}

export interface SignalHistory {
  id: string;
  created_at: string;
  coin_symbol: string;
  coin_label: string;
  binance_symbol: string;
  pattern_name: string;
  pattern_type: string;
  direction: "bullish" | "bearish";
  timeframe: string;
  entry_price: number;
  sl_price: number;
  tp_price: number;
  outcome: "pending" | "hit_tp" | "hit_sl";
}

export interface WatchlistItem {
  id: string;
  coin_symbol: string;
  coin_label: string;
  binance_symbol: string;
}

export type AppTab = "chart" | "scanner" | "watchlist" | "history" | "alerts" | "depth" | "trades" | "heatmap" | "confluence" | "backtest";

export interface MarketStats {
  high24h: number;
  low24h: number;
  volume24h: number;
  priceChangePercent24h: number;
}

export interface PriceAlert {
  id: string;
  coin_symbol: string;
  binance_symbol: string;
  target_price: number;
  direction: "above" | "below";
  current_price: number;
  triggered: boolean;
  created_at: string;
}

export interface SRLevel {
  price: number;
  type: "support" | "resistance";
  touches: number;
}

export interface PatternWithConfidence {
  pattern: DetectedPattern;
  confidence: number;
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
}

export interface OrderBookData {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
}

export interface RecentTrade {
  id: number;
  price: number;
  quantity: number;
  time: number;
  isBuyerMaker: boolean;
}

export interface HeatmapItem {
  symbol: string;
  label: string;
  change: number;
  price: number;
  volume: number;
}

export interface BacktestResult {
  patternName: string;
  direction: "bullish" | "bearish";
  entryPrice: number;
  exitPrice: number;
  outcome: "win" | "loss";
  pnl: number;
  pnlPercent: number;
  candlesHeld: number;
  date: string;
}

export interface BacktestSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnlPercent: number;
  bestTrade: number;
  worstTrade: number;
  results: BacktestResult[];
}

export interface ConfluenceSignal {
  timeframe: Timeframe;
  direction: "bullish" | "bearish" | "neutral";
  patternName: string | null;
  rsi: number;
  trend: "uptrend" | "downtrend" | "sideways";
  confidence: number;
}

export interface ConfluenceResult {
  signals: ConfluenceSignal[];
  overallDirection: "bullish" | "bearish" | "neutral";
  score: number;
  agreement: number;
}
