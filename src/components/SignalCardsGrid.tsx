import React, { useCallback, useEffect, useRef, useState } from "react";
import { Zap, RefreshCw, TrendingUp, TrendingDown, Rocket, Newspaper, Star } from "lucide-react";
import { fetchTopUsdtPairs, fetchCandles } from "../lib/binance";
import { fetchLatestNews } from "../lib/NewsService";
import type { NewsEvent } from "../lib/NewsService";
import { evaluateConfluence } from "../lib/ConfluenceEngine";
import { scanSMC } from "../lib/SMCScanner";
import { atr, bollingerBands } from "../lib/indicators";
import { calculateAtrStopLoss } from "../lib/BinanceAutoTrade";
import { formatPrice } from "../lib/patterns";
import { COINS, PRO_COINS } from "../constants";
import type { Coin, Timeframe } from "../types";

interface SqueezeResult {
  blastReady: boolean;
  squeeze: boolean;
  volumeDryUp: boolean;
  tight: boolean;
  bbWidth: number;
  squeezeHigh: number;
  squeezeLow: number;
}

interface SignalCard {
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
  bbWidth: number;
  news: boolean;
  headline?: string;
  publishedAt?: string;
  alertReason: string;
}

interface Props {
  timeframe: Timeframe;
  onSelectCoin: (coin: Coin) => void;
  onTradeNow: (coin: Coin, price: number, atr: number) => void;
  watchlistSymbols?: Set<string>;
  onToggleWatch?: (coin: Coin) => void;
}

const ALL_KNOWN_COINS = [...COINS, ...PRO_COINS];
const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h"];

function findCoin(symbol: string): Coin {
  return (
    ALL_KNOWN_COINS.find((coin) => coin.symbol === symbol) || {
      symbol,
      label: symbol,
      binanceSymbol: `${symbol}USDT`,
    }
  );
}

function detectSqueeze(candles: { high: number; low: number; close: number; volume: number }[]): SqueezeResult {
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
  const squeeze = recentWidths.length >= 10 && currentWidth <= minRecentWidth + 1e-9;

  const recentVolumes = candles.slice(-21, -1).map((c) => c.volume);
  const avgVolume =
    recentVolumes.reduce((sum, value) => sum + value, 0) / Math.max(1, recentVolumes.length);
  const volumeDryUp = candles[last].volume < Math.max(1, avgVolume) * 0.5;

  const recentFive = candles.slice(-5);
  const highMax = Math.max(...recentFive.map((c) => c.high));
  const lowMin = Math.min(...recentFive.map((c) => c.low));
  const tight = lowMin > 0 && (highMax - lowMin) / lowMin < 0.03;

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

export default function SignalCardsGrid({ timeframe: initialTimeframe, onSelectCoin, onTradeNow, watchlistSymbols, onToggleWatch }: Props) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>(initialTimeframe);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [newsEvents, setNewsEvents] = useState<NewsEvent[]>([]);
  const [newsCards, setNewsCards] = useState<SignalCard[]>([]);
  const [squeezeCards, setSqueezeCards] = useState<SignalCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "long" | "short" | "blast">("all");
  const [sort, setSort] = useState<"squeeze" | "volume" | "score">("squeeze");

  const audioContextRef = useRef<AudioContext | null>(null);
  const previousKeysRef = useRef<Set<string>>(new Set());
  const hasScannedRef = useRef(false);

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
    setSelectedTimeframe(initialTimeframe);
  }, [initialTimeframe]);

  useEffect(() => {
    let active = true;
    void fetchTopUsdtPairs(100).then((result) => {
      if (active) setCoins(result);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadNews = async () => {
      const events = await fetchLatestNews();
      if (active) setNewsEvents(events);
    };
    void loadNews();
    const timer = setInterval(() => void loadNews(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const scan = useCallback(async () => {
    if (coins.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(newsCards.length === 0 && squeezeCards.length === 0);

    const newsSymbols = new Set(newsEvents.flatMap((event) => event.symbols));
    const nextNewsCards: SignalCard[] = [];

    await Promise.all(
      newsEvents.map(async (event) => {
        const symbol = event.symbols[0];
        if (!symbol) return;
        const coin = findCoin(symbol);
        try {
          const data = await fetchCandles(coin.binanceSymbol, 30, selectedTimeframe);
          if (data.length < 21) return;

          const volumes = data.map((candle) => candle.volume);
          const avgVolume =
            volumes.slice(-21, -1).reduce((sum, value) => sum + value, 0) / 20;
          const currentVolume = volumes[volumes.length - 1];
          if (!(currentVolume > Math.max(1, avgVolume) * 3)) return;

          const price = data[data.length - 1].close;
          const first = data[Math.max(0, data.length - 5)].close;
          const change = first > 0 ? ((price - first) / first) * 100 : 0;
          const atrSeries = atr(data, 14);
          const atrValue = atrSeries[atrSeries.length - 1] || price * 0.02;
          const direction: "LONG" | "SHORT" = event.negative ? "SHORT" : "LONG";
          const levels = calculateAtrStopLoss(price, atrValue, direction, 1.5, 2.0);

          nextNewsCards.push({
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
            bbWidth: 0,
            news: true,
            headline: event.title,
            publishedAt: event.publishedAt,
            alertReason: "Breaking news with volume spike",
          });
        } catch {
          // Ignore individual fetch failures so one bad symbol does not stop the scan.
        }
      })
    );

    const settled = await Promise.allSettled(
      coins
        .filter((coin) => !newsSymbols.has(coin.symbol))
        .map(async (coin) => {
          const data = await fetchCandles(coin.binanceSymbol, 100, selectedTimeframe);
          if (data.length < 50) return null;

          const squeeze = detectSqueeze(data);
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

          const entryPrice = direction === "LONG" ? squeeze.squeezeHigh : squeeze.squeezeLow;
          const levels = calculateAtrStopLoss(entryPrice, atrValue, direction, 1.5, 2.0);

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
            bbWidth: squeeze.bbWidth,
            news: false,
            alertReason: "BB squeeze, volume dry-up, and tight 5-candle range",
          } as SignalCard;
        })
    );

    const nextSqueezeCards = settled
      .map((result) => (result.status === "fulfilled" ? result.value : null))
      .filter((value): value is SignalCard => value !== null)
      .sort((a, b) => a.bbWidth - b.bbWidth);

    const nextKeys = new Set([...nextNewsCards, ...nextSqueezeCards].map((card) => `${card.news ? "news" : "squeeze"}-${card.coin.binanceSymbol}`));
    if (hasScannedRef.current && [...nextKeys].some((key) => !previousKeysRef.current.has(key))) {
      playBeep();
    }
    hasScannedRef.current = true;
    previousKeysRef.current = nextKeys;

    setNewsCards(nextNewsCards);
    setSqueezeCards(nextSqueezeCards);
    setLoading(false);
  }, [coins, selectedTimeframe, newsEvents, newsCards.length, squeezeCards.length, playBeep]);

  useEffect(() => {
    void scan();
    const timer = setInterval(() => void scan(), 5000);
    return () => clearInterval(timer);
  }, [scan]);

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
      if (filter === "blast") return true;
      return true;
    })
  );

  const renderCard = (card: SignalCard) => {
    const watched = watchlistSymbols?.has(card.coin.binanceSymbol) ?? false;
    return (
      <div
        key={`${card.news ? "news" : "squeeze"}-${card.coin.binanceSymbol}`}
        className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-lg"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <button
              onClick={() => onSelectCoin(card.coin)}
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
                  onToggleWatch(card.coin);
                }}
                className="text-slate-500 hover:text-yellow-400 transition"
                title={watched ? "Remove from watchlist" : "Add to watchlist"}
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

        {card.headline && (
          <p className="mt-2 text-[11px] text-slate-300 line-clamp-2">{card.headline}</p>
        )}

        {!card.news && (
          <div className="mt-2 text-[11px] text-slate-300">
            Pending Entry:{" "}
            <span className="font-mono font-bold text-cyan-300">{formatPrice(card.entryPrice)}</span>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2">
            <div className="text-slate-500">Stop Loss</div>
            <div className="font-mono font-bold text-red-400">{formatPrice(card.stopLoss)}</div>
          </div>
          <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2">
            <div className="text-slate-500">Take Profit</div>
            <div className="font-mono font-bold text-green-400">{formatPrice(card.takeProfit)}</div>
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
          <button
            onClick={() => onTradeNow(card.coin, card.entryPrice, card.atr)}
            className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-black transition"
          >
            Trade Now
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Professional Scanner Radar</h2>
          <p className="text-xs text-slate-500">Hybrid news, squeeze, filter, sort, and watchlist controls</p>
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

      {filteredNewsCards.length > 0 && filter !== "blast" && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-white">🔥 Trending / News Alerts</h2>
            <p className="text-xs text-slate-500">Breaking news with live volume spikes</p>
          </div>
          <div className="grid grid-cols-2 gap-3">{filteredNewsCards.map(renderCard)}</div>
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-white">Pre-Breakout Squeeze Scanner</h2>
          <p className="text-xs text-slate-500">Top 100 USDT pairs by volume • auto-refreshing every 5 seconds</p>
        </div>

        {loading && newsCards.length === 0 && squeezeCards.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Scanning markets...
          </div>
        ) : filteredSqueezeCards.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-500">
            No matching setups found right now.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">{filteredSqueezeCards.map(renderCard)}</div>
        )}
      </section>
    </div>
  );
}
