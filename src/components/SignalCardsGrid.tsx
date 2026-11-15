import React, { useCallback, useEffect, useRef, useState } from "react";
import { Zap, RefreshCw, TrendingUp, TrendingDown, Rocket, Newspaper, Star, Volume2, VolumeX, AlertCircle, Settings, ChevronDown, ExternalLink } from "lucide-react";
import { fetchTopUsdtPairs, fetchCandles, fetch24hQuoteVolumes, fetchMarketCaps } from "../lib/binance";
import { fetchLatestNews } from "../lib/NewsService";
import type { NewsEvent } from "../lib/NewsService";
import { evaluateConfluence } from "../lib/ConfluenceEngine";
import { ema } from "../lib/indicators";
import ScannerTradeSettings, { loadScannerExecutionSettings } from "./ScannerTradeSettings";
import type { ScannerExecutionSettings } from "./ScannerTradeSettings";
import TradeConfirmModal from "./TradeConfirmModal";
import { scanSMC } from "../lib/SMCScanner";
import { atr, bollingerBands } from "../lib/indicators";
import { calculateAtrStopLoss } from "../lib/BinanceAutoTrade";
import { formatPrice } from "../lib/patterns";
import { COINS, PRO_COINS } from "../constants";
import type { Coin, Timeframe } from "../types";

interface Thresholds {
  squeezeWidth: number;
  volumeSpikeMultiplier: number;
  volumeDryUp: number;
  tightness: number;
}

interface SqueezeResult {
  blastReady: boolean;
  squeeze: boolean;
  volumeDryUp: boolean;
  tight: boolean;
  bbWidth: number;
  squeezeHigh: number;
  squeezeLow: number;
}

export interface SignalCard {
  coin: Coin;
  price: number;
  change: number;
  score: number;
  direction: "LONG" | "SHORT";
  stopLoss: number;
  takeProfit: number;
  entryPrice: number;
  atr: number;
  volume: number;
  volume24h: number;
  marketCap: number;
  sparkline: number[];
  bbWidth: number;
  news: boolean;
  headline?: string;
  newsSource?: string;
  newsUrl?: string;
  publishedAt?: string;
  alertReason: string;
  signalAgeMs?: number;
  firstSeenAt?: number;
}

interface Props {
  timeframe: Timeframe;
  onSelectCoin: (coin: Coin) => void;
  onTradeNow: (coin: Coin, price: number, atr: number) => void;
  watchlistSymbols?: Set<string>;
  onToggleWatch?: (coin: Coin) => void;
  onOneClickTrade?: (card: SignalCard, settings: ScannerExecutionSettings) => Promise<{ success: boolean; error?: string }> | void;
  activeTrades?: Array<{ symbol: string; direction?: string; entryPrice?: number; quantity?: number }>;
  onManagePosition?: (symbol: string) => void;
}

const ALL_KNOWN_COINS = [...COINS, ...PRO_COINS];
const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h"];
const DEFAULT_THRESHOLDS: Thresholds = {
  squeezeWidth: 0.06,
  volumeSpikeMultiplier: 3,
  volumeDryUp: 0.5,
  tightness: 0.03,
};

function findCoin(symbol: string): Coin {
  return (
    ALL_KNOWN_COINS.find((coin) => coin.symbol === symbol) || {
      symbol,
      label: symbol,
      binanceSymbol: `${symbol}USDT`,
    }
  );
}

function detectSqueeze(
  candles: { high: number; low: number; close: number; volume: number }[],
  thresholds: Thresholds
): SqueezeResult {
  const closes = candles.map((c) => c.close);
  const bb = bollingerBands(closes, 20, 2);
  const last = candles.length - 1;

  const widths: number[] = [];
  for (let i = 19; i <= last; i++) {
    const upper = bb.upper[i];
    const lower = bb.lower[i];
    const middle = bb.middle[i];
    if (upper != null && lower != null && middle) {
      widths.push((upper - lower) / middle);
    }
  }

  const currentWidth = widths.length ? widths[widths.length - 1] : 1;
  const recentWidths = widths.slice(-50);
  const minRecentWidth = recentWidths.length ? Math.min(...recentWidths) : currentWidth;
  const squeeze =
    recentWidths.length >= 10 &&
    currentWidth <= minRecentWidth + 1e-9 &&
    currentWidth <= thresholds.squeezeWidth;

  const recentVolumes = candles.slice(-21, -1).map((c) => c.volume);
  const avgVolume =
    recentVolumes.reduce((sum, value) => sum + value, 0) / Math.max(1, recentVolumes.length);
  const volumeDryUp = candles[last].volume < Math.max(1, avgVolume) * thresholds.volumeDryUp;

  const recentFive = candles.slice(-5);
  const highMax = Math.max(...recentFive.map((c) => c.high));
  const lowMin = Math.min(...recentFive.map((c) => c.low));
  const tight = lowMin > 0 && (highMax - lowMin) / lowMin < thresholds.tightness;

  return {
    blastReady: squeeze && volumeDryUp && tight,
    squeeze,
    volumeDryUp,
    tight,
    bbWidth: currentWidth,
    squeezeHigh: highMax,
    squeezeLow: lowMin,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R | null>
): Promise<R[]> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await fn(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  });
  await Promise.all(workers);
  return results.filter((value): value is R => value !== null);
}

function formatCompact(value: number): string {
  if (!value) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatRelativeTime(value?: string): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-6 w-20" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 78 + 1;
      const y = 23 - ((value - min) / range) * 22;
      return `${x},${y}`;
    })
    .join(" ");
  const positive = values[values.length - 1] >= values[0];
  return (
    <svg viewBox="0 0 80 24" className="h-6 w-20">
      <polyline
        fill="none"
        stroke={positive ? "#22c55e" : "#ef4444"}
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}

function computeObv(candles: { close: number; volume: number }[]): number[] {
  const obv: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    let next = obv[i - 1];
    if (curr.close > prev.close) next += curr.volume;
    else if (curr.close < prev.close) next -= curr.volume;
    obv.push(next);
  }
  return obv;
}

export default function SignalCardsGrid({ timeframe: initialTimeframe, onSelectCoin, watchlistSymbols, onToggleWatch, onOneClickTrade, activeTrades, onManagePosition }: Props) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>(() => {
    const stored = localStorage.getItem("scanner_timeframe");
    return stored && TIMEFRAMES.includes(stored as Timeframe) ? (stored as Timeframe) : initialTimeframe;
  });
  const [coins, setCoins] = useState<Coin[]>([]);
  const [newsEvents, setNewsEvents] = useState<NewsEvent[]>([]);
  const [newsCards, setNewsCards] = useState<SignalCard[]>([]);
  const [squeezeCards, setSqueezeCards] = useState<SignalCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "long" | "short" | "blast">(() => {
    const stored = localStorage.getItem("scanner_filter");
    return stored === "all" || stored === "long" || stored === "short" || stored === "blast" ? stored : "all";
  });
  const [sort, setSort] = useState<"squeeze" | "volume" | "score">(() => {
    const stored = localStorage.getItem("scanner_sort");
    return stored === "squeeze" || stored === "volume" || stored === "score" ? stored : "squeeze";
  });
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [watchedSymbols, setWatchedSymbols] = useState<Set<string>>(new Set(watchlistSymbols || []));
  const [visibleCount, setVisibleCount] = useState(20);
  const [toast, setToast] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tradeSettingsOpen, setTradeSettingsOpen] = useState(false);
  const [managingSymbol, setManagingSymbol] = useState<string | null>(null);
  const [confirmCard, setConfirmCard] = useState<SignalCard | null>(null);
  const [thresholds, setThresholds] = useState<Thresholds>(() => {
    const squeezeWidth = Number(localStorage.getItem("scanner_squeeze_width"));
    const volumeSpikeMultiplier = Number(localStorage.getItem("scanner_volume_spike_multiplier"));
    const tightness = Number(localStorage.getItem("scanner_tightness"));
    const volumeDryUp = Number(localStorage.getItem("scanner_volume_dry_up"));
    return {
      squeezeWidth: Number.isFinite(squeezeWidth) && squeezeWidth > 0 ? squeezeWidth : DEFAULT_THRESHOLDS.squeezeWidth,
      volumeSpikeMultiplier: Number.isFinite(volumeSpikeMultiplier) && volumeSpikeMultiplier > 0 ? volumeSpikeMultiplier : DEFAULT_THRESHOLDS.volumeSpikeMultiplier,
      tightness: Number.isFinite(tightness) && tightness > 0 ? tightness : DEFAULT_THRESHOLDS.tightness,
      volumeDryUp: Number.isFinite(volumeDryUp) && volumeDryUp > 0 ? volumeDryUp : DEFAULT_THRESHOLDS.volumeDryUp,
    };
  });
  const [marketCaps, setMarketCaps] = useState<Record<string, number>>({});
  const [volumes24h, setVolumes24h] = useState<Record<string, number>>({});

  const audioContextRef = useRef<AudioContext | null>(null);
  const signalCacheRef = useRef<Map<string, { card: SignalCard; firstSeenAt: number }>>(new Map());
  const previousKeysRef = useRef<Set<string>>(new Set());
  const hasScannedRef = useRef(false);
  const isMountedRef = useRef(true);
  const hasCardsRef = useRef(false);
  const soundEnabledRef = useRef(soundEnabled);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    hasCardsRef.current = newsCards.length > 0 || squeezeCards.length > 0;
  }, [newsCards, squeezeCards]);

  useEffect(() => {
    setWatchedSymbols(new Set(watchlistSymbols || []));
  }, [watchlistSymbols]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    localStorage.setItem("scanner_timeframe", selectedTimeframe);
  }, [selectedTimeframe]);
  useEffect(() => {
    localStorage.setItem("scanner_filter", filter);
  }, [filter]);
  useEffect(() => {
    localStorage.setItem("scanner_sort", sort);
  }, [sort]);
  useEffect(() => {
    localStorage.setItem("scanner_squeeze_width", thresholds.squeezeWidth.toString());
    localStorage.setItem("scanner_volume_spike_multiplier", thresholds.volumeSpikeMultiplier.toString());
    localStorage.setItem("scanner_tightness", thresholds.tightness.toString());
    localStorage.setItem("scanner_volume_dry_up", thresholds.volumeDryUp.toString());
  }, [thresholds]);

  useEffect(() => {
    if (!settingsOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [settingsOpen]);

  const playBeep = useCallback(() => {
    try {
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.06;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.14);
    } catch {
      // Audio is an enhancement only; ignore browser restrictions.
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadCoins = useCallback(async () => {
    if (!isMountedRef.current) return;
    setMarketError(null);
    try {
      const result = await fetchTopUsdtPairs(100);
      if (isMountedRef.current) setCoins(result);
    } catch (error) {
      if (isMountedRef.current) {
        setMarketError(error instanceof Error ? error.message : "Failed to load market data.");
      }
    }
  }, []);

  const loadNews = useCallback(async () => {
    if (!isMountedRef.current) return;
    setNewsError(null);
    try {
      const events = await fetchLatestNews();
      if (isMountedRef.current) setNewsEvents(events);
    } catch (error) {
      if (isMountedRef.current) {
        setNewsError(error instanceof Error ? error.message : "Failed to load news.");
      }
    }
  }, []);

  useEffect(() => {
    void loadCoins();
  }, [loadCoins]);

  useEffect(() => {
    void loadNews();
    const timer = setInterval(() => void loadNews(), 30000);
    return () => clearInterval(timer);
  }, [loadNews]);

  useEffect(() => {
    let active = true;
    void fetch24hQuoteVolumes().then((result) => {
      if (active && isMountedRef.current) setVolumes24h(result);
    });
    void fetchMarketCaps().then((result) => {
      if (active && isMountedRef.current) setMarketCaps(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const scan = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (coins.length === 0) {
      if (isMountedRef.current) setLoading(false);
      return;
    }

    if (!hasCardsRef.current) setLoading(true);

    const newsSymbols = new Set(newsEvents.flatMap((event) => event.symbols));
    const nextNewsCards: SignalCard[] = [];

    // Higher-timeframe (4H) BTC trend filter: only allow signals aligned with BTC.
    let btcBullish = true;
    try {
      const btcCandles = await fetchCandles("BTCUSDT", 60, "4h");
      const closes = btcCandles.map((c) => c.close);
      const emaSeries = ema(closes, 50);
      const lastEma = emaSeries[emaSeries.length - 1];
      const lastClose = closes[closes.length - 1];
      if (Number.isFinite(lastEma as number)) btcBullish = lastClose > (lastEma as number);
    } catch {
      btcBullish = true;
    }

    await mapWithConcurrency(newsEvents, 5, async (event) => {
      const symbol = event.symbols[0];
      if (!symbol) return null;
      const coin = findCoin(symbol);
      try {
        const data = await fetchCandles(coin.binanceSymbol, 30, selectedTimeframe);
        if (!isMountedRef.current || data.length < 21) return null;

        const volumes = data.map((candle) => candle.volume);
        const avgVolume =
          volumes.slice(-21, -1).reduce((sum, value) => sum + value, 0) / 20;
        const currentVolume = volumes[volumes.length - 1];
        if (!(currentVolume > Math.max(1, avgVolume) * thresholds.volumeSpikeMultiplier)) return null;

        const price = data[data.length - 1].close;
        const first = data[Math.max(0, data.length - 5)].close;
        const change = first > 0 ? ((price - first) / first) * 100 : 0;
        const atrSeries = atr(data, 14);
        const atrValue = atrSeries[atrSeries.length - 1] || price * 0.02;
        const direction: "LONG" | "SHORT" = event.negative ? "SHORT" : "LONG";
        if (direction === "LONG" && !btcBullish) return null;
        if (direction === "SHORT" && btcBullish) return null;

        const volume24h = volumes24h[coin.symbol] || 0;
        if (volume24h < 10_000_000) return null;
        const obvSeries = computeObv(data);
        const obvTrend =
          obvSeries[obvSeries.length - 1] -
          (obvSeries[Math.max(0, obvSeries.length - 6)] ?? obvSeries[0]);
        if (direction === "LONG" && !(obvTrend > 0)) return null;
        if (direction === "SHORT" && !(obvTrend < 0)) return null;

        const levels = calculateAtrStopLoss(price, atrValue, direction, 2.0, 2.0);

        const card: SignalCard = {
          coin,
          price,
          change,
          score: 99,
          direction,
          stopLoss: levels.stopLossPrice,
          takeProfit: levels.takeProfitPrice,
          entryPrice: price,
          atr: atrValue,
          volume: currentVolume,
          volume24h: volume24h,
          marketCap: marketCaps[coin.symbol] || 0,
          sparkline: data.slice(-20).map((candle) => candle.close),
          bbWidth: 0,
          news: true,
          headline: event.title,
          newsSource: event.source,
          newsUrl: event.url,
          publishedAt: event.publishedAt,
          alertReason: "Breaking news with volume spike",
        };
        nextNewsCards.push(card);
        return card;
      } catch {
        return null;
      }
    });

    if (!isMountedRef.current) return;

    const squeezeResults = await mapWithConcurrency(
      coins.filter((coin) => !newsSymbols.has(coin.symbol)),
      5,
      async (coin) => {
        const data = await fetchCandles(coin.binanceSymbol, 100, selectedTimeframe);
        if (!isMountedRef.current || data.length < 50) return null;

        const latestPrice = data[data.length - 1].close;
        const recentCloses = data.slice(-20).map((candle) => candle.close);
        const recentRange = Math.max(...recentCloses) - Math.min(...recentCloses);
        const recentAverage = recentCloses.reduce((sum, value) => sum + value, 0) / Math.max(1, recentCloses.length);
        const recentVolatility = recentAverage > 0 ? recentRange / recentAverage : 0;
        if (latestPrice >= 0.98 && latestPrice <= 1.02 && recentVolatility < 0.005) return null;

        const squeeze = detectSqueeze(data, thresholds);
        if (!squeeze.blastReady) return null;

        const smcData = scanSMC(data);
        const confluence = evaluateConfluence(data, smcData, null);
        const price = data[data.length - 1].close;
        const first = data[Math.max(0, data.length - 25)].close;
        const change = first > 0 ? ((price - first) / first) * 100 : 0;
        const atrSeries = atr(data, 14);
        const atrValue = atrSeries[atrSeries.length - 1] || price * 0.02;
        const volumes = data.map((candle) => candle.volume);
        const currentVolume = volumes[volumes.length - 1];

        const direction: "LONG" | "SHORT" =
          confluence?.setupBias?.includes("Buy") ? "LONG" : "SHORT";

        if (direction === "LONG" && !btcBullish) return null;
        if (direction === "SHORT" && btcBullish) return null;

        const volume24h = volumes24h[coin.symbol] || 0;
        if (volume24h < 10_000_000) return null;
        const obvSeries = computeObv(data);
        const obvTrend =
          obvSeries[obvSeries.length - 1] -
          (obvSeries[Math.max(0, obvSeries.length - 6)] ?? obvSeries[0]);
        if (direction === "LONG" && !(obvTrend > 0)) return null;
        if (direction === "SHORT" && !(obvTrend < 0)) return null;

        const entryPrice = direction === "LONG" ? squeeze.squeezeHigh : squeeze.squeezeLow;
        const levels = calculateAtrStopLoss(entryPrice, atrValue, direction, 2.0, 2.0);

        return {
          coin,
          price,
          change,
          score: confluence?.score ?? 0,
          direction,
          stopLoss: levels.stopLossPrice,
          takeProfit: levels.takeProfitPrice,
          entryPrice,
          atr: atrValue,
          volume: currentVolume,
          volume24h: volumes24h[coin.symbol] || 0,
          marketCap: marketCaps[coin.symbol] || 0,
          sparkline: data.slice(-20).map((candle) => candle.close),
          bbWidth: squeeze.bbWidth,
          news: false,
          alertReason: "BB squeeze, volume dry-up, and tight 5-candle range",
        } as SignalCard;
      }
    );

    if (!isMountedRef.current) return;

    const nextSqueezeCards = squeezeResults.sort((a, b) => a.bbWidth - b.bbWidth);

    const nextKeys = new Set([...nextNewsCards, ...nextSqueezeCards].map((card) => `${card.news ? "news" : "squeeze"}-${card.coin.binanceSymbol}`));
    if (hasScannedRef.current && soundEnabledRef.current && [...nextKeys].some((key) => !previousKeysRef.current.has(key))) {
      playBeep();
    }
    hasScannedRef.current = true;
    previousKeysRef.current = nextKeys;

    if (!isMountedRef.current) return;

    // --- Signal persistence: keep squeeze signals alive for 5 minutes -------
    // so a setup that flickers on a single candle is still actionable.
    const now = Date.now();
    const cache = signalCacheRef.current;
    for (const card of nextSqueezeCards) {
      const key = card.coin.binanceSymbol;
      const existing = cache.get(key);
      if (!existing) {
        cache.set(key, { card, firstSeenAt: now });
      } else {
        cache.set(key, { card: { ...card, firstSeenAt: existing.firstSeenAt }, firstSeenAt: existing.firstSeenAt });
      }
    }
    for (const [key, entry] of cache) {
      const age = now - entry.firstSeenAt;
      const price = entry.card.price;
      const tp = entry.card.takeProfit;
      const sl = entry.card.stopLoss;
      const direction = entry.card.direction;
      const hitTarget =
        direction === "LONG"
          ? price >= tp || price <= sl
          : price <= tp || price >= sl;
      if (age > 5 * 60 * 1000 || hitTarget) {
        cache.delete(key);
      }
    }
    const persistedSqueezeCards = [...cache.values()].map(({ card, firstSeenAt }) => ({
      ...card,
      firstSeenAt,
      signalAgeMs: now - firstSeenAt,
    }));

    setNewsCards(nextNewsCards);
    setSqueezeCards(persistedSqueezeCards);
    setLoading(false);
  }, [coins, selectedTimeframe, newsEvents, thresholds, volumes24h, marketCaps, playBeep]);

  useEffect(() => {
    void scan();
    const timer = setInterval(() => void scan(), 5000);
    return () => clearInterval(timer);
  }, [scan]);

  useEffect(() => {
    setVisibleCount(20);
  }, [filter, sort, selectedTimeframe, coins]);

  const handleDirectTrade = (card: SignalCard) => {
    setConfirmCard(card);
  };

  const handleConfirmTrade = async () => {
    if (!confirmCard) return;
    const settings = loadScannerExecutionSettings();
    try {
      const result = await onOneClickTrade?.(confirmCard, settings);
      if (result && typeof result === "object" && "success" in result && !result.success) {
        setToast(`Trade failed: ${result.error || confirmCard.coin.symbol}`);
      } else {
        setToast(`Trade executed: ${confirmCard.coin.symbol}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown execution error";
      console.error("[Scanner] direct trade failed:", error);
      setToast(`Trade failed: ${msg}`);
    }
    if (settings.soundOnExecution) playBeep();
    setConfirmCard(null);
  };

  const handleToggleWatch = useCallback((coin: Coin) => {
    setWatchedSymbols((previous) => {
      const next = new Set(previous);
      if (next.has(coin.binanceSymbol)) next.delete(coin.binanceSymbol);
      else next.add(coin.binanceSymbol);
      return next;
    });
    setToast(watchedSymbols.has(coin.binanceSymbol) ? `Removed ${coin.symbol} from watchlist` : `Added ${coin.symbol} to watchlist`);
    onToggleWatch?.(coin);
  }, [onToggleWatch, watchedSymbols]);

  const filteredNewsCards = newsCards.filter((card) => {
    if (filter === "long") return card.direction === "LONG";
    if (filter === "short") return card.direction === "SHORT";
    if (filter === "blast") return false;
    return true;
  });

  const sortSqueezeCards = (cards: SignalCard[]) => {
    const next = [...cards];
    if (sort === "volume") next.sort((a, b) => b.volume - a.volume);
    else if (sort === "score") next.sort((a, b) => b.score - a.score);
    else next.sort((a, b) => a.bbWidth - b.bbWidth);
    return next;
  };

  const filteredSqueezeCards = sortSqueezeCards(
    squeezeCards.filter((card) => {
      if (filter === "long") return card.direction === "LONG";
      if (filter === "short") return card.direction === "SHORT";
      return true;
    })
  );

  const visibleSqueezeCards = filteredSqueezeCards.slice(0, visibleCount);

  const renderCard = (card: SignalCard) => {
    const watched = watchedSymbols.has(card.coin.binanceSymbol);
    const activeTrade = (activeTrades || []).find((trade) => trade.symbol === card.coin.binanceSymbol);
    const isLongTrade = activeTrade?.direction?.toUpperCase() !== "SHORT";
    return (
      <div
        key={`${card.news ? "news" : "squeeze"}-${card.coin.binanceSymbol}`}
        role="button"
        tabIndex={0}
        aria-label={`Open chart for ${card.coin.symbol}`}
        onClick={() => onSelectCoin(card.coin)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectCoin(card.coin);
          }
        }}
        className="rounded-2xl border border-slate-800 bg-slate-900/80 p-2 sm:p-3 shadow-lg cursor-pointer transition hover:border-cyan-500/60 hover:scale-[1.01] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onSelectCoin(card.coin);
              }}
              className="text-sm font-bold text-white hover:text-cyan-300 transition"
            >
              {card.coin.symbol}/USDT
            </button>
            <div className="text-xs text-slate-400 font-mono">{formatPrice(card.price)}</div>
          </div>
          <div className="flex items-center gap-2">
            {onToggleWatch && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  handleToggleWatch(card.coin);
                }}
                className="text-slate-500 hover:text-yellow-400 transition"
                title={watched ? "Remove from watchlist" : "Add to watchlist"}
                aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
              >
                <Star className={`w-4 h-4 ${watched ? "fill-yellow-400 text-yellow-400" : ""}`} />
              </button>
            )}
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                card.direction === "LONG"
                  ? "bg-green-500/20 text-green-400 border border-green-500/40"
                  : "bg-red-500/20 text-red-400 border border-red-500/40"
              }`}
            >
              {card.direction}
            </span>
          </div>
        </div>

        {card.news ? (
          <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/40">
            <Newspaper className="w-3 h-3" />
            🚨 BREAKING NEWS
          </div>
        ) : (
          <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
            <Rocket className="w-3 h-3" />
            🚀 Blast Ready
          </div>
        )}

        {activeTrade && (
          <div
            className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              isLongTrade
                ? "bg-green-500/20 text-green-400 border-green-500/40"
                : "bg-red-500/20 text-red-400 border-red-500/40"
            }`}
          >
            {isLongTrade ? "🟢" : "🔴"} IN TRADE
          </div>
        )}

        {!card.news && typeof card.signalAgeMs === "number" && (
          <div className="mt-1 text-[10px] text-slate-500">
            Signal Age: {Math.max(1, Math.round(card.signalAgeMs / 60000))}m
          </div>
        )}

        {card.headline && (
          <p className="mt-2 text-[11px] text-slate-300 line-clamp-2">{card.headline}</p>
        )}

        {card.news && (
          <div className="mt-2 text-[10px] text-slate-400 flex flex-wrap items-center gap-2">
            {card.newsSource && <span>{card.newsSource}</span>}
            {card.publishedAt && <span>{formatRelativeTime(card.publishedAt)}</span>}
            {card.newsUrl && (
              <a
                href={card.newsUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
              >
                Source <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {!card.news && (
          <div className="mt-2 text-[11px] text-slate-300">
            Pending Entry:{" "}
            <span className="font-mono font-bold text-cyan-300">{formatPrice(card.entryPrice)}</span>
          </div>
        )}

        <div className="mt-3">
          <Sparkline values={card.sparkline} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2">
            <div className="text-slate-500">Stop Loss</div>
            <div className="font-mono font-bold text-red-400">{formatPrice(card.stopLoss)}</div>
          </div>
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2">
            <div className="text-slate-500">Take Profit</div>
            <div className="font-mono font-bold text-green-400">{formatPrice(card.takeProfit)}</div>
          </div>
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2">
            <div className="text-slate-500">24h Volume</div>
            <div className="font-mono font-bold text-slate-200">{formatCompact(card.volume24h)}</div>
          </div>
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2">
            <div className="text-slate-500">Market Cap</div>
            <div className="font-mono font-bold text-slate-200">{formatCompact(card.marketCap)}</div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span>Score {card.score}/100</span>
            <span className={card.change >= 0 ? "text-green-400" : "text-red-400"}>
              {card.change >= 0 ? <TrendingUp className="w-3 h-3 inline" /> : <TrendingDown className="w-3 h-3 inline" />}
              {Math.abs(card.change).toFixed(2)}%
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {activeTrade ? (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  setManagingSymbol(card.coin.binanceSymbol);
                  onManagePosition?.(card.coin.binanceSymbol);
                }}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[11px] font-black transition"
              >
                Manage Position
              </button>
            ) : (
              <>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setTradeSettingsOpen(true);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 text-[11px] font-black transition"
                  title="Trade Execution Settings"
                >
                  ⚙️
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleDirectTrade(card);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-black transition"
                >
                  Trade Now
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const skeletonCards = Array.from({ length: 6 }, (_, index) => (
    <div key={`skeleton-${index}`} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-2 sm:p-3 shadow-lg animate-pulse">
      <div className="h-4 w-24 rounded bg-slate-800" />
      <div className="mt-3 h-3 w-32 rounded bg-slate-800" />
      <div className="mt-4 h-6 w-full rounded bg-slate-800" />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="h-12 rounded bg-slate-800" />
        <div className="h-12 rounded bg-slate-800" />
        <div className="h-12 rounded bg-slate-800" />
        <div className="h-12 rounded bg-slate-800" />
      </div>
    </div>
  ));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Professional Scanner Radar</h2>
          <p className="text-xs text-slate-500">Hybrid news, squeeze, enrichment, and performance controls</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Timeframe</label>
          <select
            value={selectedTimeframe}
            onChange={(event) => setSelectedTimeframe(event.target.value as Timeframe)}
            className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
          >
            {TIMEFRAMES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            onClick={() => setTradeSettingsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition"
            title="Trade Execution Settings"
          >
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
          </button>
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen((value) => !value)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition"
              title="Scanner thresholds"
            >
              <Settings className="w-3.5 h-3.5" />
              <ChevronDown className="w-3 h-3" />
            </button>
            {settingsOpen && (
              <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-xl space-y-3">
                <div>
                  <label className="text-xs text-slate-400">Squeeze Width %</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="0.2"
                    value={thresholds.squeezeWidth}
                    onChange={(event) => setThresholds((value) => ({ ...value, squeezeWidth: Number(event.target.value) }))}
                    className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Volume Spike Multiplier</label>
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    max="10"
                    value={thresholds.volumeSpikeMultiplier}
                    onChange={(event) => setThresholds((value) => ({ ...value, volumeSpikeMultiplier: Number(event.target.value) }))}
                    className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Tightness %</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.005"
                    max="0.2"
                    value={thresholds.tightness}
                    onChange={(event) => setThresholds((value) => ({ ...value, tightness: Number(event.target.value) }))}
                    className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Volume Dry-Up Ratio</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="0.9"
                    value={thresholds.volumeDryUp}
                    onChange={(event) => setThresholds((value) => ({ ...value, volumeDryUp: Number(event.target.value) }))}
                    className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
                  />
                </div>
                <button
                  onClick={() => {
                    setThresholds(DEFAULT_THRESHOLDS);
                    setSelectedTimeframe(initialTimeframe);
                    setFilter("all");
                    setSort("squeeze");
                    [
                      "scanner_timeframe",
                      "scanner_filter",
                      "scanner_sort",
                      "scanner_squeeze_width",
                      "scanner_volume_spike_multiplier",
                      "scanner_tightness",
                      "scanner_volume_dry_up",
                    ].forEach((key) => localStorage.removeItem(key));
                  }}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition"
                >
                  Reset Defaults
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setSoundEnabled((value) => !value)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition"
            title={soundEnabled ? "Mute sound alerts" : "Unmute sound alerts"}
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => void scan()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {(["all", "long", "short", "blast"] as const).map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                filter === item
                  ? "bg-cyan-500 text-slate-950"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {item === "all"
                ? "All"
                : item === "long"
                ? "Long Only"
                : item === "short"
                ? "Short Only"
                : "Blast Ready"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Sort</label>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as "squeeze" | "volume" | "score")}
            className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
          >
            <option value="squeeze">Tightest Squeeze</option>
            <option value="volume">Highest Volume</option>
            <option value="score">Highest Score</option>
          </select>
        </div>
      </div>

      {marketError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{marketError}</span>
          </div>
          <button
            onClick={() => void loadCoins()}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-xs font-bold"
          >
            Retry
          </button>
        </div>
      )}

      {newsError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{newsError}</span>
          </div>
          <button
            onClick={() => void loadNews()}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-bold"
          >
            Retry
          </button>
        </div>
      )}

      {filteredNewsCards.length > 0 && filter !== "blast" && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-white">🔥 Trending / News Alerts</h2>
            <p className="text-xs text-slate-500">Breaking news with live volume spikes</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">{filteredNewsCards.map(renderCard)}</div>
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-white">Pre-Breakout Squeeze Scanner</h2>
          <p className="text-xs text-slate-500">Top 100 USDT pairs by volume • auto-refreshing every 5 seconds</p>
        </div>

        {loading && newsCards.length === 0 && squeezeCards.length === 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">{skeletonCards}</div>
        ) : filteredSqueezeCards.length === 0 && !marketError ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            No matching setups found right now.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">{visibleSqueezeCards.map(renderCard)}</div>
            {visibleCount < filteredSqueezeCards.length && (
              <div className="flex justify-center">
                <button
                  onClick={() => setVisibleCount((value) => value + 20)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition"
                >
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <ScannerTradeSettings open={tradeSettingsOpen} onClose={() => setTradeSettingsOpen(false)} />

      {confirmCard && (
        <TradeConfirmModal
          isOpen={!!confirmCard}
          onClose={() => setConfirmCard(null)}
          onConfirm={handleConfirmTrade}
          cardData={confirmCard}
          settings={loadScannerExecutionSettings()}
        />
      )}


      {managingSymbol && (() => {
        const trade = (activeTrades || []).find((t) => t.symbol === managingSymbol);
        const card = [...squeezeCards, ...newsCards].find((c) => c.coin.binanceSymbol === managingSymbol);
        const currentPrice = card?.price ?? 0;
        const entryPrice = trade?.entryPrice ?? 0;
        const quantity = trade?.quantity ?? 0;
        const pnl = trade
          ? (trade.direction === "SHORT"
              ? (entryPrice - currentPrice) * quantity
              : (currentPrice - entryPrice) * quantity)
          : 0;
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-white">Manage Position — {managingSymbol}</h3>
              {trade ? (
                <div className="text-xs text-slate-300 space-y-1">
                  <div>Direction: {trade.direction || "LONG"}</div>
                  <div>Entry: {formatPrice(trade.entryPrice ?? 0)}</div>
                  <div>Current: {formatPrice(currentPrice)}</div>
                  <div className={pnl >= 0 ? "text-green-400" : "text-red-400"}>Unrealized PnL: {pnl.toFixed(2)}</div>
                </div>
              ) : (
                <p className="text-xs text-slate-400">No active trade found.</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setManagingSymbol(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {toast && (
        <div className="fixed top-4 left-1/2 z-[9999] -translate-x-1/2 rounded-lg bg-slate-800 border border-slate-700 px-4 py-2 text-xs text-slate-200 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
