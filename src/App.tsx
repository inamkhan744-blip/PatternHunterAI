import { useCallback, useEffect, useState } from "react";
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
  List,
  Star,
  History as HistoryIcon,
} from "lucide-react";
import CandlestickChart from "./components/CandlestickChart";
import PatternPanel from "./components/PatternPanel";
import ProModal from "./components/ProModal";
import ScanPanel from "./components/ScanPanel";
import MarketScanner from "./components/MarketScanner";
import Watchlist from "./components/Watchlist";
import SignalHistory from "./components/SignalHistory";
import { COINS, PRO_COINS } from "./constants";
import { fetchCandles } from "./lib/binance";
import { detectPattern, formatPrice } from "./lib/patterns";
import {
  generateFallbackAnalysis,
  parseAnalysisPrices,
  getFallbackPrices,
} from "./lib/fallback";
import { supabase } from "./lib/supabase";
import { canScan, incrementScanCount, getRemainingScans, FREE_LIMIT } from "./lib/scanLimit";
import type { Candle, Coin, DetectedPattern, ScanResult, Timeframe, WatchlistItem, AppTab } from "./types";

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

const TABS: { key: AppTab; label: string; icon: typeof ChartIcon }[] = [
  { key: "chart", label: "Chart", icon: ChartIcon },
  { key: "scanner", label: "Scanner", icon: List },
  { key: "watchlist", label: "Watchlist", icon: Star },
  { key: "history", label: "History", icon: HistoryIcon },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("chart");
  const [selectedCoin, setSelectedCoin] = useState<Coin>(COINS[0]);
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [pattern, setPattern] = useState<DetectedPattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [coinDropdownOpen, setCoinDropdownOpen] = useState(false);
  const [tfDropdownOpen, setTfDropdownOpen] = useState(false);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);

  const [explanation, setExplanation] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [entryPrice, setEntryPrice] = useState<number | null>(null);

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

  // ---- Pro state: ?pro=true for testing ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("pro") === "true") {
      setIsPro(true);
    }
    setRemainingScans(getRemainingScans());
  }, []);

  // ---- Watchlist ----
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

  // ---- Data loading ----
  const loadData = useCallback(async (binanceSymbol: string, tf: Timeframe) => {
    setLoading(true);
    setExplanation(null);
    setAiError(null);
    setEntryPrice(null);
    try {
      const data = await fetchCandles(binanceSymbol, 200, tf);
      setCandles(data);
      setPattern(detectPattern(data));
      if (data.length >= 2) {
        const first = data[data.length - 25]?.close ?? data[0].close;
        const last = data[data.length - 1].close;
        setLastPrice(last);
        setPriceChange(((last - first) / first) * 100);
      }
    } catch {
      setCandles([]);
      setPattern(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(selectedCoin.binanceSymbol, timeframe);
  }, [selectedCoin, timeframe, loadData]);

  // ---- AI Analysis ----
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
        return;
      }
      const text = data.explanation ?? "No analysis available.";
      setExplanation(text);
      const parsed = parseAnalysisPrices(text);
      if (parsed) {
        setEntryPrice(parsed.entry);
      } else {
        const prices = getFallbackPrices(pattern, lastPrice);
        setEntryPrice(prices.entry);
      }
    } catch {
      clearTimeout(timeoutId);
      const fallback = generateFallbackAnalysis(pattern, selectedCoin.symbol, lastPrice);
      setExplanation(fallback);
      setAiError("AI analysis is currently unavailable — showing an automated estimate instead.");
      const prices = getFallbackPrices(pattern, lastPrice);
      setEntryPrice(prices.entry);
    } finally {
      setAiLoading(false);
    }
  }, [pattern, lastPrice, selectedCoin, candles]);

  // ---- Save signal to history ----
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
      if (isPro) {
        runScan();
      }
    }
  }, [isPro, scanResults.length, scanning, runScan]);

  const handleFreeScan = useCallback(() => {
    if (canScan()) {
      runScan();
    }
  }, [runScan]);

  const selectCoinFromScan = useCallback((binanceSymbol: string) => {
    const coin = [...COINS, ...PRO_COINS].find((c) => c.binanceSymbol === binanceSymbol);
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
  const tfLabel = TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? "1H";
  const inWatch = watchSymbols.has(selectedCoin.binanceSymbol);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col pb-16 lg:pb-0">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-base font-bold tracking-tight leading-none">
                PatternHunter <span className="text-cyan-400">AI</span>
              </h1>
              <span className="text-[10px] text-slate-500 leading-none mt-0.5 hidden sm:block">
                Crypto Pattern Detection
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleScanClick}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors"
            >
              <Radar className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Scan Top 50</span>
              {!isPro && <Crown className="w-3.5 h-3.5 text-amber-400" />}
            </button>
            <button
              onClick={() => setProModalOpen(true)}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 text-sm font-bold transition-all"
            >
              <Crown className="w-4 h-4" />
              <span>{isPro ? "Pro Active" : "Go Pro"}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Coin + timeframe selector bar (only on chart tab) */}
      {activeTab === "chart" && (
        <div className="border-b border-slate-800 bg-slate-900/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              {/* Coin selector */}
              <div className="relative">
                <button
                  onClick={() => setCoinDropdownOpen((v) => !v)}
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
                    <div className="absolute top-full mt-2 left-0 z-20 w-56 rounded-xl bg-slate-800 border border-slate-700 shadow-2xl overflow-hidden">
                      <div className="p-1 max-h-80 overflow-y-auto">
                        {COINS.map((coin) => (
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
                          </button>
                        ))}
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
            </div>

            <div className="flex items-center gap-3 ml-auto">
              {lastPrice && (
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold tracking-tight">{formatPrice(lastPrice)}</span>
                  <span
                    className={`text-sm font-medium ${changePercent >= 0 ? "text-green-400" : "text-red-400"}`}
                  >
                    {changePercent >= 0 ? "+" : ""}{changePercent.toFixed(2)}%
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
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full">
        {activeTab === "chart" && (
          <div className="px-4 sm:px-6 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:h-[calc(100vh-220px)] min-h-[500px]">
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
                  {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 z-10">
                      <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
                    </div>
                  )}
                  {candles.length > 0 ? (
                    <CandlestickChart candles={candles} pattern={pattern} />
                  ) : (
                    !loading && (
                      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                        No data available
                      </div>
                    )
                  )}
                </div>
              </div>

              {/* Pattern panel */}
              <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col min-h-[500px] lg:max-h-[calc(100vh-220px)]">
                <PatternPanel
                  pattern={pattern}
                  price={lastPrice}
                  explanation={explanation}
                  loading={aiLoading}
                  error={aiError}
                  onExplain={handleExplain}
                  coin={selectedCoin}
                  timeframe={timeframe}
                  onSaveSignal={handleSaveSignal}
                  entryPrice={entryPrice}
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
      </main>

      {/* Footer (desktop) */}
      <footer className="hidden lg:block border-t border-slate-800 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
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
          Disclaimer: PatternHunter AI is for educational purposes only. We are not financial advisors. Trading involves high risk. Always do your own research.
        </p>
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
                className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
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
