import { useCallback, useEffect, useState, useMemo } from "react";
import {
  Activity,
  Crown,
  Radar,
  RefreshCw,
  Loader2,
  ChevronDown,
  Github,
  Zap,
  Clock,
  CandlestickChart as ChartIcon,
  LineChart as LineIcon,
  List,
  Star,
  History as HistoryIcon,
  Bell,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Sun,
  Moon,
} from "lucide-react";
import CandlestickChart from "./components/CandlestickChart";
import PatternPanel from "./components/PatternPanel";
import ProModal from "./components/ProModal";
import ScanPanel from "./components/ScanPanel";
import MarketScanner from "./components/MarketScanner";
import MarketTicker from "./components/MarketTicker";
import Watchlist from "./components/Watchlist";
import SignalHistory from "./components/SignalHistory";
import PriceAlerts from "./components/PriceAlerts";
import { COINS, PRO_COINS } from "./constants";
import { fetchCandles, fetchMarketStats } from "./lib/binance";
import { detectPattern, detectAllPatterns, formatPrice } from "./lib/patterns";
import {
  generateFallbackAnalysis,
  parseAnalysisPrices,
  getFallbackPrices,
} from "./lib/fallback";
import { supabase } from "./lib/supabase";
import { canScan, incrementScanCount, getRemainingScans, FREE_LIMIT } from "./lib/scanLimit";
import type { Candle, Coin, DetectedPattern, ScanResult, Timeframe, WatchlistItem, AppTab, MarketStats, PatternWithConfidence } from "./types";

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
  { value: "1W", label: "1W" },
];

const TABS: { key: AppTab; label: string; icon: typeof ChartIcon }[] = [
  { key: "chart", label: "Chart", icon: ChartIcon },
  { key: "scanner", label: "Scanner", icon: List },
  { key: "watchlist", label: "Watchlist", icon: Star },
  { key: "history", label: "History", icon: HistoryIcon },
  { key: "alerts", label: "Alerts", icon: Bell },
];

const ALL_COINS = [...COINS, ...PRO_COINS];

function formatVolume(vol: number): string {
  if (vol >= 1e9) return `$${(vol / 1e9).toFixed(2)}B`;
  if (vol >= 1e6) return `$${(vol / 1e6).toFixed(2)}M`;
  if (vol >= 1e3) return `$${(vol / 1e3).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("chart");
  const [selectedCoin, setSelectedCoin] = useState<Coin>(COINS[0]);
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [pattern, setPattern] = useState<DetectedPattern | null>(null);
  const [allPatterns, setAllPatterns] = useState<PatternWithConfidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [coinDropdownOpen, setCoinDropdownOpen] = useState(false);
  const [tfDropdownOpen, setTfDropdownOpen] = useState(false);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [marketStats, setMarketStats] = useState<MarketStats | null>(null);
  const [coinSearch, setCoinSearch] = useState("");
  const [chartType, setChartType] = useState<"candles" | "line">("candles");

  const [explanation, setExplanation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [entryPrice, setEntryPrice] = useState<number | null>(null);
  const [slPrice, setSlPrice] = useState<number | null>(null);
  const [tpPrice, setTpPrice] = useState<number | null>(null);

  const [proModalOpen, setProModalOpen] = useState(false);
  const [scanPanelOpen, setScanPanelOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [remainingScans, setRemainingScans] = useState(FREE_LIMIT);

  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchSymbols, setWatchSymbols] = useState<Set<string>>(new Set());
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const filteredCoins = useMemo(() => {
    if (!coinSearch.trim()) return ALL_COINS;
    const q = coinSearch.toLowerCase();
    return ALL_COINS.filter(
      (c) => c.symbol.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
    );
  }, [coinSearch]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("pro") === "true") setIsPro(true);
    setRemainingScans(getRemainingScans());
  }, []);

  const loadWatchlist = useCallback(async () => {
    const { data } = await supabase.from("watchlist").select("*").order("created_at", { ascending: false });
    if (data) {
      setWatchlist(data as WatchlistItem[]);
      setWatchSymbols(new Set((data as WatchlistItem[]).map((w) => w.binance_symbol)));
    }
  }, []);

  useEffect(() => {
    loadWatchlist();
  }, [loadWatchlist]);

  const toggleWatch = useCallback(
    async (coin: Coin) => {
      const existing = watchlist.find((w) => w.binance_symbol === coin.binanceSymbol);
      if (existing) {
        await supabase.from("watchlist").delete().eq("id", existing.id);
      } else {
        await supabase.from("watchlist").insert({
          coin_symbol: coin.symbol,
          coin_label: coin.label,
          binance_symbol: coin.binanceSymbol,
        });
      }
      loadWatchlist();
    },
    [watchlist, loadWatchlist]
  );

  const removeWatch = useCallback(
    async (item: WatchlistItem) => {
      await supabase.from("watchlist").delete().eq("id", item.id);
      loadWatchlist();
    },
    [loadWatchlist]
  );

  const loadData = useCallback(async (binanceSymbol: string, tf: Timeframe) => {
    setLoading(true);
    setExplanation(null);
    setAiError(null);
    setEntryPrice(null);
    setSlPrice(null);
    setTpPrice(null);
    try {
      const data = await fetchCandles(binanceSymbol, 200, tf);
      setCandles(data);
      setPattern(detectPattern(data));
      setAllPatterns(detectAllPatterns(data));
      if (data.length >= 2) {
        const first = data[data.length - 25]?.close ?? data[0].close;
        const last = data[data.length - 1].close;
        setLastPrice(last);
        setPriceChange(((last - first) / first) * 100);
      }
      const stats = await fetchMarketStats(binanceSymbol);
      setMarketStats(stats);
    } catch {
      setCandles([]);
      setPattern(null);
      setAllPatterns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(selectedCoin.binanceSymbol, timeframe);
  }, [selectedCoin, timeframe, loadData]);

  useEffect(() => {
    if (activeTab !== "chart") return;
    const interval = setInterval(async () => {
      try {
        const data = await fetchCandles(selectedCoin.binanceSymbol, 5, timeframe);
        if (data.length > 0) {
          const latest = data[data.length - 1];
          setLastPrice(latest.close);
          setPriceChange(((latest.close - data[0].close) / data[0].close) * 100);
          const stats = await fetchMarketStats(selectedCoin.binanceSymbol);
          if (stats) setMarketStats(stats);
        }
      } catch {
        // silent
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [selectedCoin, timeframe, activeTab]);

  const autoResolveSignals = useCallback(async () => {
    const { data: pending } = await supabase
      .from("signal_history")
      .select("*")
      .eq("outcome", "pending");
    if (!pending || pending.length === 0) return;

    for (const sig of pending) {
      try {
        const data = await fetchCandles(sig.binance_symbol, 10, "1h");
        if (data.length === 0) continue;
        const currentPrice = data[data.length - 1].close;
        const tp = Number(sig.tp_price);
        const sl = Number(sig.sl_price);

        let outcome: "pending" | "hit_tp" | "hit_sl" = "pending";
        if (sig.direction === "bullish") {
          if (currentPrice >= tp) outcome = "hit_tp";
          else if (currentPrice <= sl) outcome = "hit_sl";
        } else {
          if (currentPrice <= tp) outcome = "hit_tp";
          else if (currentPrice >= sl) outcome = "hit_sl";
        }

        if (outcome !== "pending") {
          await supabase.from("signal_history").update({ outcome }).eq("id", sig.id);
        }
      } catch {
        // skip
      }
    }
    setHistoryRefresh((k) => k + 1);
  }, []);

  useEffect(() => {
    autoResolveSignals();
    const interval = setInterval(autoResolveSignals, 60000);
    return () => clearInterval(interval);
  }, [autoResolveSignals]);

  const handleExplain = useCallback(async () => {
    if (!pattern || !lastPrice) return;
    setAiLoading(true);
    setAiError(null);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 16000);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/explain-pattern`;
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patternName: pattern.name,
          direction: pattern.direction,
          description: pattern.description,
          coin: selectedCoin.symbol,
          price: lastPrice,
          recentCandles: candles.slice(-20),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.unavailable || !res.ok) {
        const fallback = generateFallbackAnalysis(pattern, selectedCoin.symbol, lastPrice);
        setExplanation(fallback);
        setAiError("AI analysis is currently unavailable — showing an automated estimate instead.");
        const prices = getFallbackPrices(pattern, lastPrice);
        setEntryPrice(prices.entry);
        setSlPrice(prices.sl);
        setTpPrice(prices.tp);
        return;
      }
      const text = data.explanation ?? "No analysis available.";
      setExplanation(text);
      const parsed = parseAnalysisPrices(text);
      if (parsed) {
        setEntryPrice(parsed.entry);
        setSlPrice(parsed.sl);
        setTpPrice(parsed.tp);
      } else {
        const prices = getFallbackPrices(pattern, lastPrice);
        setEntryPrice(prices.entry);
        setSlPrice(prices.sl);
        setTpPrice(prices.tp);
      }
    } catch {
      clearTimeout(timeoutId);
      const fallback = generateFallbackAnalysis(pattern, selectedCoin.symbol, lastPrice);
      setExplanation(fallback);
      setAiError("AI analysis is currently unavailable — showing an automated estimate instead.");
      const prices = getFallbackPrices(pattern, lastPrice);
      setEntryPrice(prices.entry);
      setSlPrice(prices.sl);
      setTpPrice(prices.tp);
    } finally {
      setAiLoading(false);
    }
  }, [pattern, lastPrice, selectedCoin, candles]);

  const handleSaveSignal = useCallback(async () => {
    if (!pattern || !lastPrice || !selectedCoin) return;
    let prices = parseAnalysisPrices(explanation ?? "");
    if (!prices) {
      prices = getFallbackPrices(pattern, lastPrice);
    }
    await supabase.from("signal_history").insert({
      coin_symbol: selectedCoin.symbol,
      coin_label: selectedCoin.label,
      binance_symbol: selectedCoin.binanceSymbol,
      pattern_name: pattern.name,
      pattern_type: pattern.type,
      direction: pattern.direction,
      timeframe,
      entry_price: prices.entry,
      sl_price: prices.sl,
      tp_price: prices.tp,
      outcome: "pending",
    });
    setHistoryRefresh((k) => k + 1);
  }, [pattern, lastPrice, selectedCoin, explanation, timeframe]);

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    setScanResults([]);
    try {
      const coinsToScan = [...COINS.slice(0, 5), ...PRO_COINS.slice(0, 45)];
      const settled = await Promise.allSettled(
        coinsToScan.map(async (coin): Promise<ScanResult | null> => {
          const data = await fetchCandles(coin.binanceSymbol, 100, "1h");
          const p = detectPattern(data);
          if (p) {
            return {
              symbol: coin.symbol,
              label: coin.label,
              binanceSymbol: coin.binanceSymbol,
              pattern: p,
              price: data[data.length - 1].close,
            };
          }
          return null;
        })
      );
      const results: ScanResult[] = settled
        .map((s) => (s.status === "fulfilled" ? s.value : null))
        .filter((v): v is ScanResult => v !== null);
      setScanResults(results);
      if (!isPro) {
        incrementScanCount();
        setRemainingScans(getRemainingScans());
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }, [isPro]);

  const handleScanClick = useCallback(() => {
    setScanPanelOpen(true);
    if (scanResults.length === 0 && !scanning) {
      if (isPro) runScan();
    }
  }, [isPro, scanResults.length, scanning, runScan]);

  const handleFreeScan = useCallback(() => {
    if (canScan()) runScan();
  }, [runScan]);

  const selectCoinFromScan = useCallback((binanceSymbol: string) => {
    const coin = ALL_COINS.find((c) => c.binanceSymbol === binanceSymbol);
    if (coin) {
      setSelectedCoin(coin);
      setScanPanelOpen(false);
      setActiveTab("chart");
    }
  }, []);

  const selectCoinFromTab = useCallback((coin: Coin) => {
    setSelectedCoin(coin);
    setActiveTab("chart");
  }, []);

  const changePercent = priceChange ?? 0;
  const statsChange = marketStats?.priceChangePercent24h ?? changePercent;
  const tfLabel = TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? "1H";
  const inWatch = watchSymbols.has(selectedCoin.binanceSymbol);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col lg:flex-row pb-16 lg:pb-0">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 border-r border-slate-800 bg-slate-950/80 shrink-0 sticky top-0 h-screen">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-bold tracking-tight leading-none">
              PatternHunter <span className="text-cyan-400">AI</span>
            </h1>
            <span className="text-[10px] text-slate-500 leading-none mt-1">Crypto Patterns</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? "text-cyan-400" : ""}`} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800 space-y-2">
          <button
            onClick={handleScanClick}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors"
          >
            <Radar className="w-4 h-4 text-cyan-400" />
            Scan Top 50
            {!isPro && <Crown className="w-3.5 h-3.5 text-amber-400 ml-auto" />}
          </button>
          <button
            onClick={() => setProModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 text-sm font-bold transition-all"
          >
            <Crown className="w-4 h-4" />
            {isPro ? "Pro Active" : "Go Pro"}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-40">
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-base font-bold tracking-tight">
                PatternHunter <span className="text-cyan-400">AI</span>
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleScanClick}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors"
              >
                <Radar className="w-4 h-4 text-cyan-400" />
                {!isPro && <Crown className="w-3.5 h-3.5 text-amber-400" />}
              </button>
              <button
                onClick={() => setProModalOpen(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 text-sm font-bold transition-all"
              >
                <Crown className="w-4 h-4" />
                <span>{isPro ? "Pro" : "Go Pro"}</span>
              </button>
            </div>
          </div>
        </header>

        {/* Market ticker */}
        <MarketTicker />

        {/* Coin + timeframe selector bar (only on chart tab) */}
        {activeTab === "chart" && (
          <div className="border-b border-slate-800 bg-slate-900/50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                {/* Coin selector with search */}
                <div className="relative">
                  <button
                    onClick={() => { setCoinDropdownOpen((v) => !v); setCoinSearch(""); }}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                      {selectedCoin.symbol.slice(0, 3)}
                    </div>
                    <div className="text-left">
                      <span className="text-sm font-semibold">
                        {selectedCoin.symbol}<span className="text-slate-500">/USDT</span>
                      </span>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${coinDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {coinDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setCoinDropdownOpen(false)} />
                      <div className="absolute top-full mt-2 left-0 z-20 w-72 rounded-xl bg-slate-800 border border-slate-700 shadow-2xl overflow-hidden">
                        <div className="p-2 border-b border-slate-700">
                          <div className="relative">
                            <Search className="w-4 h-4 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={coinSearch}
                              onChange={(e) => setCoinSearch(e.target.value)}
                              placeholder="Search coins..."
                              autoFocus
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder:text-slate-500 outline-none focus:border-cyan-500"
                            />
                          </div>
                        </div>
                        <div className="p-1 max-h-72 overflow-y-auto">
                          {filteredCoins.length === 0 ? (
                            <p className="text-sm text-slate-500 text-center py-4">No coins found</p>
                          ) : (
                            filteredCoins.map((coin) => {
                              const isProCoin = PRO_COINS.some((c) => c.symbol === coin.symbol);
                              return (
                                <button
                                  key={coin.symbol}
                                  onClick={() => {
                                    setSelectedCoin(coin);
                                    setCoinDropdownOpen(false);
                                  }}
                                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                                    coin.symbol === selectedCoin.symbol
                                      ? "bg-slate-700 text-white"
                                      : "text-slate-300 hover:bg-slate-700/50"
                                  }`}
                                >
                                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                                    {coin.symbol.slice(0, 3)}
                                  </div>
                                  <span className="font-medium">{coin.symbol}</span>
                                  <span className="text-slate-500 text-xs ml-auto">{coin.label}</span>
                                  {isProCoin && <Crown className="w-3 h-3 text-amber-400/50" />}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Star toggle */}
                <button
                  onClick={() => toggleWatch(selectedCoin)}
                  className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                  title={inWatch ? "Remove from watchlist" : "Add to watchlist"}
                >
                  <svg
                    className={`w-4 h-4 ${inWatch ? "text-amber-400 fill-amber-400" : "text-slate-400"}`}
                    fill={inWatch ? "currentColor" : "none"}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                </button>

                {/* Timeframe selector */}
                <div className="relative">
                  <button
                    onClick={() => setTfDropdownOpen((v) => !v)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                  >
                    <Clock className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm font-semibold">{tfLabel}</span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${tfDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {tfDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setTfDropdownOpen(false)} />
                      <div className="absolute top-full mt-2 left-0 z-20 w-32 rounded-xl bg-slate-800 border border-slate-700 shadow-2xl overflow-hidden">
                        <div className="p-1">
                          {TIMEFRAMES.map((tf) => (
                            <button
                              key={tf.value}
                              onClick={() => {
                                setTimeframe(tf.value);
                                setTfDropdownOpen(false);
                              }}
                              className={`w-full flex items-center px-3 py-2.5 rounded-lg text-sm transition-colors ${
                                tf.value === timeframe
                                  ? "bg-slate-700 text-white font-semibold"
                                  : "text-slate-300 hover:bg-slate-700/50"
                              }`}
                            >
                              {tf.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Chart type toggle */}
                <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5">
                  <button
                    onClick={() => setChartType("candles")}
                    className={`p-2 rounded-md transition-colors ${chartType === "candles" ? "bg-slate-700 text-cyan-400" : "text-slate-500 hover:text-slate-300"}`}
                    title="Candlestick view"
                  >
                    <ChartIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setChartType("line")}
                    className={`p-2 rounded-md transition-colors ${chartType === "line" ? "bg-slate-700 text-cyan-400" : "text-slate-500 hover:text-slate-300"}`}
                    title="Line view"
                  >
                    <LineIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 ml-auto">
                {lastPrice && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold tracking-tight">{formatPrice(lastPrice)}</span>
                    <span className={`text-sm font-medium flex items-center ${statsChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {statsChange >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {statsChange >= 0 ? "+" : ""}{statsChange.toFixed(2)}%
                    </span>
                  </div>
                )}
                <button
                  onClick={() => loadData(selectedCoin.binanceSymbol, timeframe)}
                  disabled={loading}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors disabled:opacity-50"
                  title="Refresh data"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* 24h market stats bar */}
            {marketStats && (
              <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-3">
                <div className="flex items-center gap-4 sm:gap-6 flex-wrap text-xs">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-slate-500">24h Vol:</span>
                    <span className="text-slate-300 font-medium">{formatVolume(marketStats.volume24h)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                    <span className="text-slate-500">24h High:</span>
                    <span className="text-green-400 font-medium">{formatPrice(marketStats.high24h)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-slate-500">24h Low:</span>
                    <span className="text-red-400 font-medium">{formatPrice(marketStats.low24h)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 max-w-7xl mx-auto w-full">
          {activeTab === "chart" && (
            <div className="px-4 sm:px-6 py-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:h-[calc(100vh-280px)] min-h-[500px]">
                {/* Chart */}
                <div className="lg:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col min-h-[400px]">
                  <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">
                        {selectedCoin.symbol}/USDT
                      </span>
                      <span className="text-xs text-slate-500">{tfLabel}</span>
                      {pattern && (
                        <span className="ml-1 flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: pattern.direction === "bullish" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                            color: pattern.direction === "bullish" ? "#4ade80" : "#f87171",
                          }}
                        >
                          <Zap className="w-3 h-3" />
                          {pattern.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-xs text-slate-500 hidden sm:inline">Live · Binance</span>
                    </div>
                  </div>
                  <div className="flex-1 relative">
                    <CandlestickChart candles={candles} pattern={pattern} loading={loading} chartType={chartType} />
                  </div>
                </div>

                {/* Pattern panel */}
                <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col min-h-[500px] lg:max-h-[calc(100vh-280px)]">
                  <PatternPanel
                    pattern={pattern}
                    allPatterns={allPatterns}
                    price={lastPrice}
                    explanation={explanation}
                    loading={aiLoading}
                    error={aiError}
                    onExplain={handleExplain}
                    coin={selectedCoin}
                    timeframe={timeframe}
                    onSaveSignal={handleSaveSignal}
                    entryPrice={entryPrice}
                    slPrice={slPrice}
                    tpPrice={tpPrice}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === "scanner" && (
            <MarketScanner
              timeframe={timeframe}
              onSelectCoin={selectCoinFromTab}
              watchlistSymbols={watchSymbols}
              onToggleWatch={toggleWatch}
            />
          )}

          {activeTab === "watchlist" && (
            <Watchlist
              timeframe={timeframe}
              watchlist={watchlist}
              onSelectCoin={selectCoinFromTab}
              onRemove={removeWatch}
            />
          )}

          {activeTab === "history" && (
            <SignalHistory
              refreshKey={historyRefresh}
              onOutcomeChange={() => setHistoryRefresh((k) => k + 1)}
            />
          )}

          {activeTab === "alerts" && (
            <PriceAlerts onSelectCoin={selectCoinFromTab} />
          )}
        </main>

        {/* Footer (desktop) */}
        <footer className="hidden lg:block border-t border-slate-800 py-3 mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>PatternHunter AI · For educational purposes — not financial advice</span>
              <Github className="w-4 h-4" />
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed max-w-4xl">
              Disclaimer: PatternHunter AI is for educational purposes only. We are not financial advisors. Trading involves high risk. Always do your own research.
            </p>
          </div>
        </footer>

        {/* Mobile disclaimer */}
        <div className="lg:hidden px-4 py-3 border-t border-slate-800 mt-auto">
          <p className="text-[11px] text-slate-600 leading-relaxed text-center">
            Disclaimer: For educational purposes only. Not financial advice. Trading involves high risk.
          </p>
        </div>
      </div>

      {/* Bottom navigation (mobile) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800">
        <div className="flex items-center justify-around px-2 py-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex flex-col items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg transition-colors ${
                  active ? "text-cyan-400" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <ProModal
        open={proModalOpen}
        onClose={() => setProModalOpen(false)}
        isPro={isPro}
      />
      <ScanPanel
        open={scanPanelOpen}
        onClose={() => setScanPanelOpen(false)}
        scanning={scanning}
        results={scanResults}
        error={scanError}
        isPro={isPro}
        remainingScans={remainingScans}
        onSelectCoin={selectCoinFromScan}
        onFreeScan={handleFreeScan}
      />
    </div>
  );
}
