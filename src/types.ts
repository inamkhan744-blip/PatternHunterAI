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

export type Timeframe = "15m" | "1h" | "4h" | "1d";

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

export type AppTab = "chart" | "scanner" | "watchlist" | "history";
