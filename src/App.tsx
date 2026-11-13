import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import {
  Activity,
  Crown,
  Trophy,
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
  Sparkles,
  Wallet,
  LogOut,
  Layers,
  Settings as SettingsIcon,
  Eye,
  Download,
  BookOpen,
  Power,
  Grid as GridIcon,
  Users,
  Cpu,
  Menu,
  SlidersHorizontal,
} from "lucide-react";
import { SideDrawer } from "./components/SideDrawer";
import CandlestickChart from "./components/CandlestickChart";
import PatternPanel from "./components/PatternPanel";
import ProModal from "./components/ProModal";
import ScanPanel from "./components/ScanPanel";
import MarketScanner from "./components/MarketScanner";
import MarketTicker from "./components/MarketTicker";
import Watchlist from "./components/Watchlist";
import SignalHistory from "./components/SignalHistory";
import PriceAlerts from "./components/PriceAlerts";
import FearGreedIndex from "./components/FearGreedIndex";
import TrendIndicator from "./components/TrendIndicator";
import NewsSentimentRadar from "./components/NewsSentimentRadar";
import MacroWidget from "./components/MacroWidget";
import AntiFOMOModal from "./components/AntiFOMOModal";
import { COINS, PRO_COINS } from "./constants";
import { fetchCandles, fetchMarketStats } from "./lib/binance";
import { detectPattern, detectAllPatterns, formatPrice } from "./lib/patterns";
import { rsi, sma, atr } from "./lib/indicators";
import AutoTradeModal from "./components/AutoTradeModal";
import { parseAnalysisPrices, getFallbackPrices } from "./lib/fallback";
import { supabase } from "./lib/supabase";
import { canScan, incrementScanCount, getRemainingScans, FREE_LIMIT } from "./lib/scanLimit";
import { useAuth } from "./lib/auth";
import AuthScreen from "./components/AuthScreen";
import ActivePositions from "./components/ActivePositions";
import AIChat from "./components/AIChat";
import Portfolio from "./components/Portfolio";
import ArbitrageTab from "./components/ArbitrageTab";
import SwarmTerminal from "./components/SwarmTerminal";
import Backtesting from "./components/Backtesting";
import VisionAIUpload from "./components/VisionAIUpload";
import SettingsModal from "./components/SettingsModal";
import AdminModal from "./components/AdminModal";
import LeaderboardModal from "./components/LeaderboardModal";
import OrderBook from "./components/OrderBook";
import PnLCalendar from "./components/PnLCalendar";
import GridBotUI from "./components/GridBotUI";
import TradingJournal from "./components/TradingJournal";
import DCABotUI from "./components/DCABotUI";
import CopyTradingTab from "./components/CopyTradingTab";
import StrategyBuilder from "./components/StrategyBuilder";
import { gridTradingBot } from "./lib/GridBot";
import { dcaBotEngine } from "./lib/DCABot";
import { webhookService, type TradingViewSignal } from "./lib/WebhookService";
import { useSubscription } from "./lib/useSubscription";
import { useServerAutoPilot } from "./lib/ServerAutoPilot";
import { isLiveTradingConfigured, refreshCredentialStatus } from "./lib/CredentialVault";
import { autoTradeEngine, MAX_SLIPPAGE_PCT } from "./lib/BinanceAutoTrade";
import { liveWorkerLogStore } from "./lib/LiveWorkerLogStore";
import { getActiveExchange, setActiveExchange, SUPPORTED_EXCHANGES, type ExchangeId } from "./lib/MultiExchange";
import { paperTradingEngine } from "./lib/PaperTrading";
import { tradeManager } from "./lib/TradeManager";
import { pushNotificationService } from "./lib/PushNotification";
import { evaluateConfluence } from "./lib/ConfluenceEngine";
import { scanSMC, calculateHTFTrend, type HTFTrendResult } from "./lib/SMCScanner";
import { subscribeTicker } from "./lib/websocket";
import type { Candle, Coin, DetectedPattern, ScanResult, Timeframe, WatchlistItem, AppTab, MarketStats, PatternWithConfidence } from "./types";

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
  { value: "1W", label: "1W" },
];

interface NavGroup {
  groupTitle: string;
  items: { key: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupTitle: "Trading",
    items: [
      { key: "chart", label: "Chart", icon: ChartIcon },
      { key: "positions", label: "Positions & History", icon: Layers },
      { key: "depth", label: "Order Book", icon: BookOpen },
    ],
  },
  {
    groupTitle: "Tools & Bots",
    items: [
      { key: "grid", label: "Grid Bot", icon: GridIcon },
      { key: "dca", label: "DCA Bot", icon: RefreshCw },
      { key: "copy", label: "Strategy Marketplace", icon: Users },
      { key: "strategy", label: "Strategy Builder", icon: Cpu },
      { key: "arbitrage", label: "Arbitrage", icon: ArrowUpRight },
      { key: "backtest", label: "Backtest Lab", icon: BarChart3 },
    ],
  },
  {
    groupTitle: "Market Insights",
    items: [
      { key: "scanner", label: "Scanner", icon: List },
      { key: "watchlist", label: "Watchlist", icon: Star },
      { key: "history", label: "Signals", icon: HistoryIcon },
      { key: "alerts", label: "Alerts", icon: Bell },
      { key: "chat", label: "AI Chat", icon: Sparkles },
      { key: "journal", label: "Journal", icon: BookOpen },
      { key: "portfolio", label: "Portfolio", icon: Wallet },
    ],
  },
];

const MOBILE_TABS: { key: AppTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "chart", label: "Chart", icon: ChartIcon },
  { key: "positions", label: "Positions", icon: Layers },
  { key: "scanner", label: "Scanner", icon: List },
  { key: "portfolio", label: "Portfolio", icon: Wallet },
  { key: "grid", label: "Bots", icon: GridIcon },
];

const ALL_COINS = [...COINS, ...PRO_COINS];

/** Auto-Pilot scans these symbols so it is not limited to the chart on screen. */
const AUTO_PILOT_SCAN_UNIVERSE = [...COINS].slice(0, 8);

interface AutoPilotCandidate {
  symbol: string;
  price: number;
  signalPrice: number;
  atr: number;
  rsi: number | null;
  trend: string | null;
  patternName: string | null;
  patternDirection: "bullish" | "bearish" | null;
  fearGreed: number | null;
  dataTimestamp: number;
  score: number;
  candleKey: number;
}

function formatVolume(vol: number): string {
  if (vol >= 1e9) return `$${(vol / 1e9).toFixed(2)}B`;
  if (vol >= 1e6) return `$${(vol / 1e6).toFixed(2)}M`;
  if (vol >= 1e3) return `$${(vol / 1e3).toFixed(1)}K`;
  return `$${vol.toFixed(0)}`;
}

export default function App() {
  const { user, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<AppTab>("chart");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
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
  const [chartError, setChartError] = useState<string | null>(null);
  const [entryPrice, setEntryPrice] = useState<number | null>(null);
  const [slPrice, setSlPrice] = useState<number | null>(null);
  const [tpPrice, setTpPrice] = useState<number | null>(null);

  const [proModalOpen, setProModalOpen] = useState(false);
  const [scanPanelOpen, setScanPanelOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [remainingScans, setRemainingScans] = useState(FREE_LIMIT);

  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [watchSymbols, setWatchSymbols] = useState<Set<string>>(new Set());
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [autoTradeOpen, setAutoTradeOpen] = useState(false);
  const [currentAtr, setCurrentAtr] = useState<number>(0);
  const [swarmOpen, setSwarmOpen] = useState(false);

  // Vision AI & Settings Modals
  const [visionAIOpen, setVisionAIOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [leaderboardModalOpen, setLeaderboardModalOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  // Role & subscription come exclusively from the RLS-protected `user_profiles` row.
  // No email allow-list, no user_metadata, no URL parameter can elevate privileges.
  const {
    isAdmin,
    isPro: effectiveIsPro,
    loading: subscriptionLoading,
    refresh: refreshSubscription,
  } = useSubscription(user);

  // Server-side (24/7) Auto-Pilot. The browser only mirrors the DB flag; the
  // execution loop lives in the auto-trade-worker edge function.
  const { enabled: serverAutoPilot, setEnabled: setServerAutoPilot } = useServerAutoPilot(user);
  const [autoPilotSaving, setAutoPilotSaving] = useState(false);
  const [autoPilotError, setAutoPilotError] = useState<string | null>(null);

  // Multi-Exchange State
  const [currentExchange, setCurrentExchange] = useState<ExchangeId>(() => getActiveExchange());

  // Auto-Pilot master state synced with autoTradeEngine
  const [autoPilotActive, setAutoPilotActive] = useState<boolean>(() => autoTradeEngine.getConfig().autoPilotEnabled);
  const [autoPilotStatusText, setAutoPilotStatusText] = useState<string>(() =>
    autoTradeEngine.getConfig().autoPilotEnabled
      ? "Status: Armed — waiting for a fresh candle close"
      : "Status: Auto-Pilot Idle"
  );
  const [autoPilotPauseReason, setAutoPilotPauseReason] = useState<string | null>(() =>
    autoTradeEngine.getAutoPilotPauseReason()
  );

  // Subscribe to liveWorkerLogStore to update autoPilotStatusText in real-time
  useEffect(() => {
    const unsub = liveWorkerLogStore.subscribe((_, latestLog) => {
      if (latestLog?.message) {
        if (latestLog.message.includes("Trade rejected:")) {
          const reason = latestLog.message.replace("Trade rejected:", "Blocked by").trim();
          setAutoPilotStatusText(`Status: ${reason}`);
        } else if (latestLog.message.includes("Auto-Pilot Paused")) {
          setAutoPilotStatusText("Status: Auto-Pilot Paused — AI Engine Offline");
        } else if (latestLog.message.includes("AI Engine Offline") || latestLog.message.includes("Gemini API")) {
          setAutoPilotStatusText("Status: AI Engine Offline — paused");
        } else if (latestLog.message.includes("Cooldown active")) {
          setAutoPilotStatusText("Status: Cooldown active — preventing revenge trading");
        } else if (latestLog.message.includes("Scanning")) {
          setAutoPilotStatusText("Status: Scanning for a fresh candle close");
        } else if (latestLog.message.includes("Auto-Pilot Armed")) {
          setAutoPilotStatusText("Status: Armed — waiting for a fresh candle close");
        } else if (latestLog.message.includes("Auto-Pilot Disarmed")) {
          setAutoPilotStatusText("Status: Auto-Pilot Idle");
        } else if (latestLog.message.includes("Executing ")) {
          setAutoPilotStatusText(`Status: ${latestLog.message}`);
        } else if (latestLog.message.includes("Trade Blocked")) {
          setAutoPilotStatusText(`Status: ${latestLog.message.replace("Trade Blocked:", "Blocked —")}`);
        }
      }
    });
    return () => unsub();
  }, []);

  // Keep the header toggle in sync with engine-initiated state changes (AI pause,
  // kill switch, daily-loss halt) — not just user clicks.
  useEffect(() => {
    const sync = () => {
      setAutoPilotActive(autoTradeEngine.getConfig().autoPilotEnabled);
      setAutoPilotPauseReason(autoTradeEngine.getAutoPilotPauseReason());
    };
    const timer = setInterval(sync, 2000);
    return () => clearInterval(timer);
  }, []);

  // System Status State: Live vs Paper mode, WebSocket ping latency
  const [isPaperMode, setIsPaperMode] = useState<boolean>(() => !isLiveTradingConfigured());
  // Real stream health: time of the last received tick (no synthetic latency).
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [streamAgeSec, setStreamAgeSec] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setStreamAgeSec(lastTickAt === null ? null : Math.round((Date.now() - lastTickAt) / 1000));
    }, 5000);
    return () => clearInterval(timer);
  }, [lastTickAt]);

  // Collapsible panels state for Chart UI optimization
  const [lowerPanelsOpen, setLowerPanelsOpen] = useState(true);
  const [patternPanelOpen, setPatternPanelOpen] = useState(true);

  // HTF Trend state for Auto-Pilot Confluence Calculation
  const [htfTrendState, setHtfTrendState] = useState<HTFTrendResult | null>(null);
  const autoTradeExecutionLock = useRef<boolean>(
    typeof localStorage !== "undefined" &&
    Number(localStorage.getItem("fortress_autopilot_execution_lock") || 0) > Date.now()
  );
  const autoPilotArmedTimestamp = useRef<number>(Date.now());
  const lastProcessedCandleTimestamp = useRef<number>(0);
  // One entry per (symbol, candle) across both the live tick and the scanner.
  const processedSignalKeys = useRef<Set<string>>(new Set());
  const [rsiValue, setRsiValue] = useState<number | null>(null);
  const [trendValue, setTrendValue] = useState<string | null>(null);
  const [fearGreedValue, setFearGreedValue] = useState<number | null>(null);

  // Anti-FOMO state
  const [fomoLocked, setFomoLocked] = useState(false);
  const [fomoRemainingSeconds, setFomoRemainingSeconds] = useState(0);
  const [fomoModalOpen, setFomoModalOpen] = useState(false);
  const [priceChange1h, setPriceChange1h] = useState(0);

  useEffect(() => {
    if (isAdmin) setProModalOpen(false);
    void refreshCredentialStatus().then(() => setIsPaperMode(!isLiveTradingConfigured()));
  }, [isAdmin]);

  const filteredCoins = useMemo(() => {
    if (!coinSearch.trim()) return ALL_COINS;
    const q = coinSearch.toLowerCase();
    return ALL_COINS.filter(
      (c) => c.symbol.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
    );
  }, [coinSearch]);

  useEffect(() => {
    // NOTE: no `?pro=true` shortcut exists. Pro entitlement is read from the server
    // record only, and trade/scan quotas are enforced server-side.
    void refreshSubscription();
    setRemainingScans(getRemainingScans());

    // Restore existing FOMO lock from localStorage if active
    const savedLockUntil = localStorage.getItem("anti_fomo_lock_until");
    if (savedLockUntil) {
      const lockUntil = parseInt(savedLockUntil, 10);
      const diffSec = Math.floor((lockUntil - Date.now()) / 1000);
      if (diffSec > 0) {
        setFomoLocked(true);
        setFomoRemainingSeconds(diffSec);
      } else {
        localStorage.removeItem("anti_fomo_lock_until");
      }
    }
  }, [isAdmin]);

  // Countdown timer for Anti-FOMO lock
  useEffect(() => {
    if (!fomoLocked) return;
    const timer = setInterval(() => {
      const savedLockUntil = localStorage.getItem("anti_fomo_lock_until");
      if (savedLockUntil) {
        const diffSec = Math.floor((parseInt(savedLockUntil, 10) - Date.now()) / 1000);
        if (diffSec <= 0) {
          setFomoLocked(false);
          setFomoRemainingSeconds(0);
          localStorage.removeItem("anti_fomo_lock_until");
        } else {
          setFomoRemainingSeconds(diffSec);
        }
      } else {
        setFomoLocked(false);
        setFomoRemainingSeconds(0);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [fomoLocked]);

  const [watchlistError, setWatchlistError] = useState<string | null>(null);

  const loadWatchlist = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("watchlist")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      if (data) {
        setWatchlist(data as WatchlistItem[]);
        setWatchSymbols(new Set((data as WatchlistItem[]).map((w) => w.binance_symbol)));
      }
      setWatchlistError(null);
    } catch (err) {
      // Keep whatever is on screen; tell the user instead of silently showing an
      // empty watchlist as if nothing were saved.
      setWatchlistError(
        `Watchlist sync failed: ${err instanceof Error ? err.message : "network error"}. Showing the last loaded list.`
      );
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadWatchlist();
      tradeManager.initializeUser(user.id);
    } else {
      tradeManager.cleanupRealtime();
      setWatchlist([]);
      setWatchSymbols(new Set());
    }
  }, [user, loadWatchlist]);

  // Cross-device watchlist sync: another device's add/remove lands here within seconds.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`watchlist-sync-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "watchlist", filter: `user_id=eq.${user.id}` },
        () => {
          void loadWatchlist();
        }
      )
      .subscribe();
    return () => {
      try {
        channel.unsubscribe();
      } catch {
        // ignore
      }
    };
  }, [user, loadWatchlist]);

  const toggleWatch = useCallback(
    async (coin: Coin) => {
      if (!user) {
        setWatchlistError("Sign in to sync your watchlist across devices.");
        return;
      }

      const existing = watchlist.find((w) => w.binance_symbol === coin.binanceSymbol);
      try {
        if (existing) {
          const { error } = await supabase.from("watchlist").delete().eq("id", existing.id);
          if (error) throw new Error(error.message);
        } else {
          // Upsert on (user_id, binance_symbol) makes double-taps and retries harmless.
          const { error } = await supabase.from("watchlist").upsert(
            {
              user_id: user.id,
              coin_symbol: coin.symbol,
              coin_label: coin.label,
              binance_symbol: coin.binanceSymbol,
            },
            { onConflict: "user_id,binance_symbol", ignoreDuplicates: true }
          );
          if (error) throw new Error(error.message);
        }
        setWatchlistError(null);
      } catch (err) {
        setWatchlistError(
          `Could not update watchlist: ${err instanceof Error ? err.message : "network error"}. Nothing was lost — retry when back online.`
        );
      }
      await loadWatchlist();
    },
    [watchlist, loadWatchlist, user]
  );

  const removeWatch = useCallback(
    async (item: WatchlistItem) => {
      try {
        const { error } = await supabase.from("watchlist").delete().eq("id", item.id);
        if (error) throw new Error(error.message);
        setWatchlistError(null);
      } catch (err) {
        setWatchlistError(
          `Could not remove ${item.coin_symbol}: ${err instanceof Error ? err.message : "network error"}.`
        );
      }
      await loadWatchlist();
    },
    [loadWatchlist]
  );

  const loadData = useCallback(async (binanceSymbol: string, tf: Timeframe) => {
    setLoading(true);
    setExplanation(null);
    setAiError(null);
    setChartError(null);
    setEntryPrice(null);
    setSlPrice(null);
    setTpPrice(null);
    try {
      const data = await fetchCandles(binanceSymbol, 200, tf);
      setCandles(data);
      const foundPattern = detectPattern(data);
      setPattern(foundPattern);
      const allFound = detectAllPatterns(data);
      setAllPatterns(allFound);

      // Trigger Push Notification if pattern detected
      if (foundPattern && data.length > 0) {
        const currentClose = data[data.length - 1].close;
        const topConfidence = allFound.length > 0 ? allFound[0].confidence : undefined;
        pushNotificationService.notifyPatternDetected({
          symbol: binanceSymbol,
          patternName: foundPattern.name,
          direction: foundPattern.direction,
          price: currentClose,
          confidence: topConfidence,
        }).catch(() => {});
      }

      if (data.length >= 15) {
        const atrSeries = atr(data, 14);
        const lastAtr = atrSeries[atrSeries.length - 1];
        if (lastAtr !== null && lastAtr !== undefined) {
          setCurrentAtr(lastAtr);
        }
      }

      if (data.length >= 2) {
        const first = data[data.length - 25]?.close ?? data[0].close;
        const last = data[data.length - 1].close;
        setLastPrice(last);
        setPriceChange(((last - first) / first) * 100);
        const closes = data.map((c) => c.close);
        const rsiData = rsi(closes, 14);
        const lastRsi = rsiData[rsiData.length - 1];
        setRsiValue(lastRsi);
        const ma7 = sma(closes, 7);
        const ma25 = sma(closes, 25);
        const lastMa7 = ma7[ma7.length - 1];
        const lastMa25 = ma25[ma25.length - 1];
        if (lastMa7 !== null && lastMa25 !== null) {
          const diff = ((lastMa7 - lastMa25) / lastMa25) * 100;
          setTrendValue(diff > 0.3 ? "uptrend" : diff < -0.3 ? "downtrend" : "sideways");
        }

        // Anti-FOMO Check: Price change of the last 1 hour
        let change1h = 0;
        if (tf === "1h") {
          const currentCandle = data[data.length - 1];
          change1h = ((currentCandle.close - currentCandle.open) / currentCandle.open) * 100;
        } else if (tf === "15m" && data.length >= 5) {
          const price1hAgo = data[data.length - 5].close;
          change1h = ((last - price1hAgo) / price1hAgo) * 100;
        } else if (tf === "5m" && data.length >= 13) {
          const price1hAgo = data[data.length - 13].close;
          change1h = ((last - price1hAgo) / price1hAgo) * 100;
        } else {
          const refIndex = Math.max(0, data.length - 2);
          const refPrice = data[refIndex].close;
          change1h = ((last - refPrice) / refPrice) * 100;
        }

        setPriceChange1h(change1h);

        // If price moved > 8% (positive or negative) in the last 1 hour
        if (Math.abs(change1h) >= 8) {
          const lockUntil = Date.now() + 10 * 60 * 1000;
          const currentSaved = localStorage.getItem("anti_fomo_lock_until");
          if (!currentSaved || parseInt(currentSaved, 10) < Date.now()) {
            localStorage.setItem("anti_fomo_lock_until", String(lockUntil));
            setFomoLocked(true);
            setFomoRemainingSeconds(10 * 60);
            setFomoModalOpen(true);
          }
        }
      }
      const stats = await fetchMarketStats(binanceSymbol);
      setMarketStats(stats);
    } catch (err) {
      setCandles([]);
      setPattern(null);
      setAllPatterns([]);
      // Say the data is unavailable instead of rendering a blank chart silently.
      setChartError(
        `Market data unavailable for ${binanceSymbol} (${err instanceof Error ? err.message : "network error"}). Retry with Refresh.`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadData(selectedCoin.binanceSymbol, timeframe);
    }
  }, [user, selectedCoin, timeframe, loadData]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key.toLowerCase() === "r" && activeTab === "chart") {
        loadData(selectedCoin.binanceSymbol, timeframe);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeTab, selectedCoin, timeframe, loadData]);

  // Periodic background candle updater and signal evaluation loop (runs autonomously every 4 seconds)
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      try {
        const data = await fetchCandles(selectedCoin.binanceSymbol, 5, timeframe);
        if (data.length > 0) {
          const latest = data[data.length - 1];
          setLastPrice(latest.close);
          setPriceChange(((latest.close - data[0].close) / data[0].close) * 100);
          const stats = await fetchMarketStats(selectedCoin.binanceSymbol);
          if (stats) setMarketStats(stats);

          // Update latest candle in state if new candle closed
          setCandles((prev) => {
            if (prev.length === 0) return prev;
            const lastPrev = prev[prev.length - 1];
            if (lastPrev.time !== latest.time) {
              const updated = [...prev.slice(1), latest];
              const p = detectPattern(updated);
              setPattern(p);
              return updated;
            }
            return prev;
          });
        }
      } catch {
        // silent
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [user, selectedCoin, timeframe, activeTab]);

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

  // HTF Trend update for background confluence calculations
  useEffect(() => {
    if (!user) return;
    let mounted = true;
    const fetchTrend = async () => {
      try {
        const trend = await calculateHTFTrend(selectedCoin.binanceSymbol);
        if (mounted) setHtfTrendState(trend);
      } catch {
        // silent
      }
    };
    fetchTrend();
    const interval = setInterval(fetchTrend, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [user, selectedCoin.binanceSymbol]);

  // TradingView Webhook Signal Execution Listener
  useEffect(() => {
    if (!user) return;

    const unsub = webhookService.subscribe(async (signal: TradingViewSignal) => {
      const config = autoTradeEngine.getConfig();
      const currentPrice = signal.price ?? lastPrice ?? 60000;
      const targetSymbol = signal.symbol || selectedCoin.binanceSymbol;
      const atrVal = currentAtr || currentPrice * 0.02;
      const direction = signal.direction === "BUY" ? "LONG" : "SHORT";

      console.log(`[TradingView Webhook Received] ${signal.direction} for ${targetSymbol} at $${currentPrice}`);

      // Check if paper trading or live execution. API keys never live in the
      // browser, so the server-side vault is the only source of truth.
      if (!isLiveTradingConfigured()) {
        const pResult = paperTradingEngine.executeOrder({
          symbol: targetSymbol,
          entryPrice: currentPrice,
          atrValue: atrVal,
          direction,
          marketType: config.marketType,
          leverage: config.leverage,
          riskPercent: config.riskPercent,
        });

        if (pResult.success && pResult.trade) {
          tradeManager.addTrade({
            symbol: pResult.trade.symbol,
            entryPrice: pResult.trade.entryPrice,
            currentPrice,
            quantity: pResult.trade.quantity,
            stopLossPrice: pResult.trade.stopLossPrice,
            takeProfitPrice: pResult.trade.takeProfitPrice,
            direction: pResult.trade.direction,
            marketType: pResult.trade.marketType,
            leverage: pResult.trade.leverage,
            source: "AUTO-PILOT",
            mode: "PAPER",
            customId: pResult.trade.id,
          });
          pushNotificationService.notifyTradeExecution({
            symbol: pResult.trade.symbol,
            direction: pResult.trade.direction,
            entryPrice: pResult.trade.entryPrice,
            source: "TradingView Webhook",
            mode: "PAPER",
          }).catch(() => {});
        }
      } else {
        try {
          const res = await autoTradeEngine.executeTrade({
            symbol: targetSymbol,
            entryPrice: currentPrice,
            atrValue: atrVal,
            direction,
            marketType: config.marketType,
          });

          if (res.success && res.trade) {
            tradeManager.addTrade({
              symbol: res.trade.symbol,
              entryPrice: res.trade.entryPrice,
              currentPrice,
              quantity: res.trade.quantity,
              stopLossPrice: res.trade.stopLossPrice,
              takeProfitPrice: res.trade.takeProfitPrice,
              direction: res.trade.direction,
              marketType: res.trade.marketType,
              leverage: res.trade.leverage,
              source: "AUTO-PILOT",
              mode: "REAL",
              customId: res.trade.id,
            });
            pushNotificationService.notifyTradeExecution({
              symbol: res.trade.symbol,
              direction: res.trade.direction,
              entryPrice: res.trade.entryPrice,
              source: "TradingView Webhook",
              mode: "REAL",
            }).catch(() => {});
          }
        } catch (err) {
          console.error("TradingView auto-execution failed:", err);
        }
      }
    });

    return () => unsub();
  }, [user, lastPrice, selectedCoin.binanceSymbol, currentAtr, effectiveIsPro, isAdmin]);

  /**
   * Counts distinct symbols with an open position in the active execution mode.
   * Engine positions and mirrored/paper positions are both included, so
   * `maxOpenTrades` is enforced across the whole book rather than per ledger.
   */
  const autoPilotOpenSymbolCount = useCallback((mode: "REAL" | "PAPER") => {
    const symbols = new Set<string>();
    autoTradeEngine.getOpenTrades().forEach((t) => symbols.add(t.symbol));
    tradeManager
      .getActiveTrades()
      .filter((t) => t.mode === mode)
      .forEach((t) => symbols.add(t.symbol));
    return symbols.size;
  }, []);

  /**
   * Single Auto-Pilot entry point shared by the live tick (displayed symbol) and the
   * multi-symbol scanner. Every gate lives here so both paths behave identically:
   * ARMED state, 30s cooldown, per-symbol duplicate block, max-open capacity,
   * real-AI verdict, direction mode and slippage protection.
   */
  const attemptAutoPilotEntry = useCallback(
    async (candidate: AutoPilotCandidate) => {
      // Server Auto-Pilot owns execution; the browser must never also trade.
      if (serverAutoPilot) return;
      const cfg = autoTradeEngine.getConfig();
      if (!cfg.autoPilotEnabled) return;

      const state = autoTradeEngine.getAutoPilotState();
      if (state !== "ARMED" && state !== "WATCHING") return;

      const signalKey = `${candidate.symbol}:${candidate.candleKey}`;
      if (processedSignalKeys.current.has(signalKey)) return;

      const cooldown = autoTradeEngine.getAutoPilotCooldown();
      if (cooldown.isActive) {
        liveWorkerLogStore.addLog(
          `Skipping: Cooldown active — preventing revenge trading (${cooldown.remainingSeconds}s remaining)`,
          "warn",
          { symbol: candidate.symbol }
        );
        return;
      }

      const postLoss = autoTradeEngine.getPostLossCooldown();
      if (postLoss.isActive) {
        liveWorkerLogStore.addLog(
          `Skipping: Cooldown active — post-loss guard (${postLoss.remainingSeconds}s remaining)`,
          "warn",
          { symbol: candidate.symbol }
        );
        return;
      }

      // Required confluence scales with volatility: high-ATR setups need a higher score.
      const requiredScore = autoTradeEngine.getRequiredConfluenceScore(
        candidate.price,
        candidate.atr
      ).requiredScore;

      // `>=` is intentional: a signal that scores exactly the required threshold
      // is tradable. Using `<=` here silently discarded every 85/85 setup.
      if (candidate.score < requiredScore) {
        const thresholdNote =
          requiredScore > 85 ? " (raised threshold: high-volatility ATR regime)" : "";
        liveWorkerLogStore.addLog(
          `Skipping: Score ${candidate.score}/100 is below the required ${requiredScore}${thresholdNote}. ` +
            `A score of exactly ${requiredScore} qualifies.`,
          "info",
          { symbol: candidate.symbol, score: candidate.score, requiredScore }
        );
        return;
      }

      // Duplicate protection is scoped to the symbol: other symbols remain tradable.
      const executionMode: "REAL" | "PAPER" = isLiveTradingConfigured() ? "REAL" : "PAPER";
      if (
        tradeManager.hasActivePosition(candidate.symbol, executionMode) ||
        autoTradeEngine.getOpenTrades().some((t) => t.symbol === candidate.symbol)
      ) {
        liveWorkerLogStore.addLog("Trade Blocked: Duplicate symbol", "warn", { symbol: candidate.symbol });
        return;
      }

      const openCount = autoPilotOpenSymbolCount(executionMode);
      if (openCount >= cfg.maxOpenTrades) {
        liveWorkerLogStore.addLog(
          `Trade Blocked: Max open trades reached (${openCount}/${cfg.maxOpenTrades})`,
          "warn",
          { symbol: candidate.symbol }
        );
        return;
      }

      // Debounce: one execution evaluation at a time across all symbols.
      const storedLock = localStorage.getItem("fortress_autopilot_execution_lock");
      const isPersistentlyLocked = storedLock ? parseInt(storedLock, 10) > Date.now() : false;
      if (autoTradeExecutionLock.current || isPersistentlyLocked) {
        liveWorkerLogStore.addLog("Scanning... execution lock active (debounce)", "info", {
          symbol: candidate.symbol,
        });
        return;
      }

      autoTradeExecutionLock.current = true;
      localStorage.setItem("fortress_autopilot_execution_lock", String(Date.now() + 15000));

      try {
        // Real AI verdict only. If the AI layer is down the engine pauses itself.
        const signal = await autoTradeEngine.evaluateAutoPilotSignal({
          symbol: candidate.symbol,
          price: candidate.price,
          rsi: candidate.rsi,
          trend: candidate.trend,
          patternName: candidate.patternName,
          patternDirection: candidate.patternDirection,
          fearGreed: candidate.fearGreed,
          atrValue: candidate.atr,
          dataTimestamp: candidate.dataTimestamp,
          minScore: requiredScore,
        });

        if (!signal.proceed) {
          liveWorkerLogStore.addLog(
            `Skipping: ${signal.reason || "AI verdict rejected the setup"} ` +
              `(confluence ${signal.score}/100, required ${requiredScore})`,
            "info",
            { symbol: candidate.symbol, score: signal.score, requiredScore }
          );
          return;
        }

        const direction = signal.direction;
        const directionMode = cfg.tradeDirectionMode || "BOTH";
        if (directionMode === "LONG_ONLY" && direction === "SHORT") {
          liveWorkerLogStore.addLog("Trade Blocked: Auto-Pilot direction mode is LONG ONLY", "warn", {
            symbol: candidate.symbol,
          });
          return;
        }
        if (directionMode === "SHORT_ONLY" && direction === "LONG") {
          liveWorkerLogStore.addLog("Trade Blocked: Auto-Pilot direction mode is SHORT ONLY", "warn", {
            symbol: candidate.symbol,
          });
          return;
        }

        // Slippage guard against the *live* market price, not a stale tick/candle.
        const livePrice = await autoTradeEngine.fetchLivePrice(candidate.symbol, cfg.marketType);
        if (livePrice === null) {
          liveWorkerLogStore.addLog("Trade cancelled: live price unavailable.", "warn", {
            symbol: candidate.symbol,
          });
          return;
        }

        const slippagePct =
          (Math.abs(livePrice - candidate.signalPrice) / candidate.signalPrice) * 100;
        if (slippagePct > MAX_SLIPPAGE_PCT) {
          liveWorkerLogStore.addLog(
            `Trade cancelled due to high slippage. (${slippagePct.toFixed(3)}% > ${MAX_SLIPPAGE_PCT}%)`,
            "warn",
            {
              symbol: candidate.symbol,
              signalPrice: candidate.signalPrice,
              currentPrice: livePrice,
            }
          );
          return;
        }

        // Mark this candle as handled so a tick flood cannot double-enter.
        processedSignalKeys.current.add(signalKey);
        if (processedSignalKeys.current.size > 500) processedSignalKeys.current.clear();
        lastProcessedCandleTimestamp.current = candidate.candleKey;

        liveWorkerLogStore.addLog(
          `Executing ${direction} on ${candidate.symbol} (Score ${signal.score}/85)`,
          "success",
          { symbol: candidate.symbol, direction, score: signal.score }
        );

        if (executionMode === "PAPER") {
          const pResult = paperTradingEngine.executeOrder({
            symbol: candidate.symbol,
            entryPrice: livePrice,
            atrValue: candidate.atr,
            direction,
            marketType: cfg.marketType,
            leverage: cfg.leverage,
            riskPercent: cfg.riskPercent,
          });

          if (pResult.success && pResult.trade) {
            tradeManager.addTrade({
              symbol: pResult.trade.symbol,
              entryPrice: pResult.trade.entryPrice,
              currentPrice: livePrice,
              quantity: pResult.trade.quantity,
              stopLossPrice: pResult.trade.stopLossPrice,
              takeProfitPrice: pResult.trade.takeProfitPrice,
              direction: pResult.trade.direction,
              marketType: pResult.trade.marketType,
              leverage: pResult.trade.leverage,
              source: "AUTO-PILOT",
              mode: "PAPER",
              customId: pResult.trade.id,
              atrAtEntry: candidate.atr,
            });
            pushNotificationService
              .notifyTradeExecution({
                symbol: pResult.trade.symbol,
                direction: pResult.trade.direction,
                entryPrice: pResult.trade.entryPrice,
                source: "Auto-Pilot AI Confluence",
                mode: "PAPER",
              })
              .catch(() => {});
          } else {
            liveWorkerLogStore.addLog(
              `Paper execution blocked: ${pResult.error || "unknown error"}`,
              "warn",
              { symbol: candidate.symbol }
            );
          }
          return;
        }

        const res = await autoTradeEngine.executeTrade({
          symbol: candidate.symbol,
          entryPrice: livePrice,
          atrValue: candidate.atr,
          direction,
          marketType: cfg.marketType,
          autoPilot: true,
          signalPrice: candidate.signalPrice,
          orderType: "MARKET",
        });

        if (res.success && res.trade) {
          tradeManager.addTrade({
            symbol: res.trade.symbol,
            entryPrice: res.trade.entryPrice,
            currentPrice: livePrice,
            quantity: res.trade.quantity,
            stopLossPrice: res.trade.stopLossPrice,
            takeProfitPrice: res.trade.takeProfitPrice,
            direction: res.trade.direction,
            marketType: res.trade.marketType,
            leverage: res.trade.leverage,
            source: "AUTO-PILOT",
            mode: res.trade.executionMode === "PAPER" ? "PAPER" : "REAL",
            customId: res.trade.id,
            slOrderId: res.trade.slOrderId,
            tpOrderId: res.trade.tpOrderId,
            atrAtEntry: candidate.atr,
          });
          pushNotificationService
            .notifyTradeExecution({
              symbol: res.trade.symbol,
              direction: res.trade.direction,
              entryPrice: res.trade.entryPrice,
              source: "Auto-Pilot AI Confluence",
              mode: res.trade.executionMode === "PAPER" ? "PAPER" : "REAL",
            })
            .catch(() => {});
        } else {
          liveWorkerLogStore.addLog(
            `Trade Blocked: ${res.error || "exchange rejected the order"}`,
            "warn",
            { symbol: candidate.symbol }
          );
        }
      } finally {
        setTimeout(() => {
          autoTradeExecutionLock.current = false;
          localStorage.removeItem("fortress_autopilot_execution_lock");
        }, 15000);
      }
    },
    [autoPilotOpenSymbolCount, serverAutoPilot]
  );

  // Multi-symbol scanner: Auto-Pilot is not limited to the chart currently on screen.
  // It scans the top market list and can hold positions on different symbols
  // simultaneously, up to maxOpenTrades.
  useEffect(() => {
    if (!user || serverAutoPilot) return;

    const scanOnce = async () => {
      const cfg = autoTradeEngine.getConfig();
      if (!cfg.autoPilotEnabled) return;
      const state = autoTradeEngine.getAutoPilotState();
      if (state !== "ARMED" && state !== "WATCHING") return;
      const scanMode: "REAL" | "PAPER" = isLiveTradingConfigured() ? "REAL" : "PAPER";
      if (autoPilotOpenSymbolCount(scanMode) >= cfg.maxOpenTrades) return;
      if (autoTradeEngine.getAutoPilotCooldown().isActive) return;
      if (autoTradeEngine.getPostLossCooldown().isActive) return;

      for (const coin of AUTO_PILOT_SCAN_UNIVERSE) {
        if (autoPilotOpenSymbolCount(scanMode) >= cfg.maxOpenTrades) break;
        if (tradeManager.hasActivePosition(coin.binanceSymbol)) continue;

        try {
          const data = await fetchCandles(coin.binanceSymbol, 120, timeframe);
          if (data.length < 30) continue;

          const smcData = scanSMC(data);
          const conf = evaluateConfluence(data, smcData, htfTrendState);
          if (!conf) continue;

          const atrSeries = atr(data, 14);
          const atrVal = atrSeries[atrSeries.length - 1];
          if (!atrVal || atrVal <= 0) continue;

          const lastClosePrice = data[data.length - 1].close;
          const requiredScore = autoTradeEngine.getRequiredConfluenceScore(
            lastClosePrice,
            atrVal
          ).requiredScore;
          if (conf.score < requiredScore) continue;

          const closes = data.map((c) => c.close);
          const rsiSeries = rsi(closes, 14);
          const lastRsi = rsiSeries[rsiSeries.length - 1];

          const ma7 = sma(closes, 7);
          const ma25 = sma(closes, 25);
          const lastMa7 = ma7[ma7.length - 1];
          const lastMa25 = ma25[ma25.length - 1];
          let trend: string | null = null;
          if (lastMa7 !== null && lastMa25 !== null && lastMa25 !== undefined && lastMa7 !== undefined) {
            const diff = ((lastMa7 - lastMa25) / lastMa25) * 100;
            trend = diff > 0.3 ? "uptrend" : diff < -0.3 ? "downtrend" : "sideways";
          }

          const lastCandle = data[data.length - 1];
          const candleMs = lastCandle.time > 1e11 ? lastCandle.time : lastCandle.time * 1000;
          // Same rule as the live tick: only candles that closed after arming.
          if (candleMs <= autoPilotArmedTimestamp.current) continue;

          const detected = detectPattern(data);

          await attemptAutoPilotEntry({
            symbol: coin.binanceSymbol,
            price: lastCandle.close,
            signalPrice: lastCandle.close,
            atr: atrVal,
            rsi: lastRsi ?? null,
            trend,
            patternName: detected?.name ?? null,
            patternDirection: detected?.direction ?? null,
            fearGreed: null,
            dataTimestamp: Date.now(),
            score: conf.score,
            candleKey: lastCandle.time,
          });
        } catch {
          // A single symbol failing must not stop the scan.
        }
      }
    };

    const timer = setInterval(() => {
      void scanOnce();
    }, 60_000);
    return () => clearInterval(timer);
  }, [user, timeframe, htfTrendState, attemptAutoPilotEntry, autoPilotOpenSymbolCount, serverAutoPilot]);

  // Position supervision loop: every open position on every symbol is marked to
  // market (SL/TP, trailing stops, P/L) — not just the chart currently on screen —
  // and the two position ledgers are reconciled so they cannot silently diverge.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const reconcileLedgers = () => {
      // Engine closed a position but the mirrored record is still open.
      for (const trade of tradeManager.getActiveTrades()) {
        const engineTrade = autoTradeEngine.getTradeById(trade.id);
        if (engineTrade && engineTrade.status === "CLOSED") {
          tradeManager.closeTrade(
            trade.id,
            engineTrade.closePrice ?? trade.currentPrice,
            engineTrade.exitReason ?? "MANUAL"
          );
        }
      }

      // Paper engine hit SL/TP on its own: close the mirrored record so the two stay
      // in step.
      for (const trade of tradeManager.getActiveTrades()) {
        if (trade.mode !== "PAPER") continue;
        const paperTrade = paperTradingEngine.getTradeById(trade.id);
        if (paperTrade && paperTrade.status === "CLOSED") {
          tradeManager.closeTrade(
            trade.id,
            paperTrade.closePrice ?? trade.currentPrice,
            paperTrade.exitReason ?? "MANUAL"
          );
        }
      }

      // Mirror closed (exchange bracket or manual close) but the engine still thinks
      // the position is open: settle the engine record without re-closing on exchange.
      const historyById = new Map(tradeManager.getTradeHistory().map((h) => [h.id, h]));
      for (const trade of autoTradeEngine.getOpenTrades()) {
        const closed = historyById.get(trade.id);
        if (!closed) continue;
        autoTradeEngine.settleClosedTrade(
          trade.id,
          closed.exitPrice,
          closed.exitReason === "TP" || closed.exitReason === "SL" ? closed.exitReason : "MANUAL"
        );
      }
    };

    const supervise = async () => {
      const symbols = new Set<string>();
      tradeManager.getActiveTrades().forEach((t) => symbols.add(t.symbol));
      autoTradeEngine.getOpenTrades().forEach((t) => symbols.add(t.symbol));
      paperTradingEngine.getOpenTrades().forEach((t) => symbols.add(t.symbol));

      for (const symbol of symbols) {
        if (cancelled) return;
        const marketType =
          tradeManager.getActiveTrades().find((t) => t.symbol === symbol)?.marketType ??
          autoTradeEngine.getConfig().marketType;
        const price = await autoTradeEngine.fetchLivePrice(symbol, marketType);
        if (price === null) continue;
        tradeManager.updateLivePrice(symbol, price);
        paperTradingEngine.evaluatePrice(price, symbol);
        autoTradeEngine.evaluateOpenTrades(price, symbol);
        gridTradingBot.onPriceTick(price, symbol);
        dcaBotEngine.onPriceTick(price, symbol);
      }

      reconcileLedgers();
    };

    void supervise();
    const timer = setInterval(() => void supervise(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user]);

  // Real-time WebSocket Price Subscription & Auto-Pilot Execution Loop
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeTicker(selectedCoin.binanceSymbol, (price, changePct) => {
      setLastTickAt(Date.now());
      // Credentials live only in the server-side vault; never infer mode from
      // browser storage, which always holds empty strings.
      setIsPaperMode(!isLiveTradingConfigured());

      setLastPrice(price);
      setPriceChange(changePct);

      // Feed real-time price to TradeManager, Grid Bot, DCA Bot & Paper Trading engine
      tradeManager.updateLivePrice(selectedCoin.binanceSymbol, price);
      gridTradingBot.onPriceTick(price, selectedCoin.binanceSymbol);
      dcaBotEngine.onPriceTick(price, selectedCoin.binanceSymbol);
      paperTradingEngine.evaluatePrice(price, selectedCoin.binanceSymbol);

      // ===================== Auto-Pilot execution loop =====================
      // The heavy lifting lives in attemptAutoPilotEntry(); this tick only decides
      // whether the displayed symbol has a *fresh* candle worth evaluating.
      // The cloud worker handles Auto-Pilot; skip the browser entry path entirely.
      if (serverAutoPilot) return;

      const config = autoTradeEngine.getConfig();
      if (!config.autoPilotEnabled) return;

      const apState = autoTradeEngine.getAutoPilotState();
      if (apState !== "ARMED" && apState !== "WATCHING") return;

      if (candles.length < 5) return;
      if (!(currentAtr > 0)) {
        liveWorkerLogStore.addLog("Scanning... waiting for volatility (ATR) data", "info", {
          symbol: selectedCoin.binanceSymbol,
        });
        return;
      }

      const latestCandle = candles[candles.length - 1];
      const candleTimeMs = latestCandle.time > 1e11 ? latestCandle.time : latestCandle.time * 1000;
      const isFreshCandle =
        candleTimeMs > autoPilotArmedTimestamp.current &&
        latestCandle.time !== lastProcessedCandleTimestamp.current;

      if (!isFreshCandle) {
        liveWorkerLogStore.addLog("Scanning... waiting for the current candle to close", "info", {
          symbol: selectedCoin.binanceSymbol,
        });
        return;
      }

      const smcData = scanSMC(candles);
      const confluence = evaluateConfluence(candles, smcData, htfTrendState);

      void attemptAutoPilotEntry({
        symbol: selectedCoin.binanceSymbol,
        price,
        signalPrice: latestCandle.close,
        atr: currentAtr,
        rsi: rsiValue,
        trend: trendValue,
        patternName: pattern?.name ?? null,
        patternDirection: pattern?.direction ?? null,
        fearGreed: fearGreedValue,
        dataTimestamp: Date.now(),
        score: confluence?.score ?? 0,
        candleKey: latestCandle.time,
      });
    });

    return () => unsub();
  }, [
    user,
    selectedCoin.binanceSymbol,
    candles,
    pattern,
    htfTrendState,
    currentAtr,
    effectiveIsPro,
    isAdmin,
    rsiValue,
    trendValue,
    fearGreedValue,
    attemptAutoPilotEntry,
    serverAutoPilot,
  ]);

  useEffect(() => {
    if (!user) return;
    autoResolveSignals();
    const interval = setInterval(autoResolveSignals, 60000);
    return () => clearInterval(interval);
  }, [user, autoResolveSignals]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function loadFearGreed() {
      try {
        const res = await fetch("https://api.alternative.me/fng/?limit=1");
        if (!res.ok) return;
        const json = await res.json();
        const val = parseInt(json.data[0].value, 10);
        if (!cancelled) setFearGreedValue(val);
      } catch {
        // ignore
      }
    }
    loadFearGreed();
    const interval = setInterval(loadFearGreed, 300000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user]);

  const handleExplain = useCallback(async () => {
    if (!pattern || !lastPrice) return;
    setAiLoading(true);
    setAiError(null);

    try {
      // First try 'ai-chat' with action: 'explain'
      let responseData: unknown = null;
      const { data: aiChatData, error: aiChatError } = await supabase.functions.invoke("ai-chat", {
        body: {
          action: "explain",
          patternName: pattern.name,
          direction: pattern.direction,
          description: pattern.description,
          coin: selectedCoin.symbol,
          price: lastPrice,
          recentCandles: candles.slice(-20),
        },
      });

      if (!aiChatError && aiChatData && !aiChatData.unavailable) {
        responseData = aiChatData;
      } else {
        // Fallback to 'explain-pattern' function
        const { data: explainData, error: explainError } = await supabase.functions.invoke("explain-pattern", {
          body: {
            patternName: pattern.name,
            direction: pattern.direction,
            description: pattern.description,
            coin: selectedCoin.symbol,
            price: lastPrice,
            recentCandles: candles.slice(-20),
          },
        });
        if (explainError || explainData?.unavailable) {
          throw explainError || new Error(explainData?.error || "All AI edges unavailable");
        }
        responseData = explainData;
      }

      // Backend may return direct format { explanation } or wrapped format { success: true, data: { ...parsedAI } | string, modelUsed: "..." }
      const resolvedData = (responseData as { data?: unknown })?.data !== undefined ? (responseData as { data: unknown }).data : responseData;

      let text = "";
      let entryVal: number | null = null;
      let slVal: number | null = null;
      let tpVal: number | null = null;

      if (typeof resolvedData === "string") {
        text = resolvedData;
      } else if (resolvedData && typeof resolvedData === "object") {
        const obj = resolvedData as Record<string, unknown>;
        if (typeof obj.explanation === "string") {
          text = obj.explanation;
        } else if (typeof obj.text === "string") {
          text = obj.text;
        } else if (typeof obj.response === "string") {
          text = obj.response;
        } else {
          // If parsedAI object contains structured fields
          const entryStr = obj.entry !== undefined ? `$${obj.entry}` : null;
          const slStr = obj.sl !== undefined ? `$${obj.sl}` : obj.stopLoss !== undefined ? `$${obj.stopLoss}` : null;
          const tpStr = obj.tp !== undefined ? `$${obj.tp}` : obj.takeProfit !== undefined ? `$${obj.takeProfit}` : null;
          const reasoningStr = String(obj.reasoning || obj.analysis || obj.summary || obj.keyTakeaway || "");

          const lines: string[] = [
            `Pattern found: ${pattern.name} at $${lastPrice.toFixed(2)}. ${pattern.direction === "bearish" ? "Expect a reversal to the downside." : "Expect a reversal to the upside."}`
          ];
          if (entryStr) lines.push(`Entry: ${entryStr}`);
          if (slStr) lines.push(`SL: ${slStr}`);
          if (tpStr) lines.push(`TP: ${tpStr}`);
          if (reasoningStr) lines.push(`Reasoning: ${reasoningStr}`);

          text = lines.join("\n");
        }

        // Direct numeric values if returned in parsedAI
        if (typeof obj.entry === "number") entryVal = obj.entry;
        else if (typeof obj.entryPrice === "number") entryVal = obj.entryPrice;

        if (typeof obj.sl === "number") slVal = obj.sl;
        else if (typeof obj.stopLoss === "number") slVal = obj.stopLoss;
        else if (typeof obj.stopLossPrice === "number") slVal = obj.stopLossPrice;

        if (typeof obj.tp === "number") tpVal = obj.tp;
        else if (typeof obj.takeProfit === "number") tpVal = obj.takeProfit;
        else if (typeof obj.takeProfitPrice === "number") tpVal = obj.takeProfitPrice;
      }

      if (!text && !entryVal) {
        throw new Error("AI returned empty analysis");
      }

      // --- Validate AI-authored levels before they reach the UI/trade modal ---
      // A hallucinated price (wrong side of the market, zero, NaN, or >50% away)
      // must never be presented as a confirmed trade level.
      const parsed = parseAnalysisPrices(text);
      const sane = (v: number | null | undefined): number | null =>
        typeof v === "number" && Number.isFinite(v) && v > 0 && Math.abs(v - lastPrice) / lastPrice <= 0.5
          ? v
          : null;

      const deterministic = getFallbackPrices(pattern, lastPrice);
      const nextEntry = sane(entryVal) ?? sane(parsed?.entry) ?? deterministic.entry;
      const aiSl = sane(slVal) ?? sane(parsed?.sl);
      const aiTp = sane(tpVal) ?? sane(parsed?.tp);

      // Stop must sit on the protective side of entry; otherwise discard it.
      const slOnCorrectSide =
        aiSl !== null && (pattern.direction === "bullish" ? aiSl < nextEntry : aiSl > nextEntry);
      const tpOnCorrectSide =
        aiTp !== null && (pattern.direction === "bullish" ? aiTp > nextEntry : aiTp < nextEntry);

      setExplanation(text);
      setAiError(
        (aiSl && !slOnCorrectSide) || (aiTp && !tpOnCorrectSide)
          ? "AI returned stop/target levels on the wrong side of entry — those levels were discarded and recalculated from ATR."
          : null
      );
      setEntryPrice(nextEntry);
      setSlPrice(slOnCorrectSide ? aiSl : deterministic.sl);
      setTpPrice(tpOnCorrectSide ? aiTp : deterministic.tp);
    } catch (err) {
      console.error("Pattern Analysis error:", err);
      const reason = err instanceof Error ? err.message : "AI services unreachable";

      // No fabricated AI narrative: say the service is unavailable and clearly label
      // the deterministic ATR/pattern projection as calculated, not AI-generated.
      const prices = getFallbackPrices(pattern, lastPrice);
      setExplanation(
        [
          `Pattern: ${pattern.name} on ${selectedCoin.symbol}/USDT at $${lastPrice.toFixed(2)}.`,
          `Entry (calculated): $${prices.entry.toFixed(2)}`,
          `SL (calculated): $${prices.sl.toFixed(2)}`,
          `TP (calculated): $${prices.tp.toFixed(2)}`,
          "These are deterministic percentage projections from the detected pattern — not AI analysis.",
        ].join("\n")
      );
      setAiError(`AI analysis unavailable (${reason}). Levels below are calculated, not AI-generated.`);
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

    if (
      ![prices.entry, prices.sl, prices.tp].every((v) => Number.isFinite(v) && v > 0)
    ) {
      setAiError("Cannot save signal: entry/SL/TP levels are invalid.");
      return;
    }

    try {
      // Duplicate guard: the same pattern on the same symbol/timeframe within one
      // candle window is one signal, not five (protects the win-rate statistics).
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: existing, error: lookupError } = await supabase
        .from("signal_history")
        .select("id")
        .eq("binance_symbol", selectedCoin.binanceSymbol)
        .eq("pattern_name", pattern.name)
        .eq("timeframe", timeframe)
        .gte("created_at", fiveMinutesAgo)
        .limit(1);

      if (lookupError) throw new Error(lookupError.message);
      if (existing && existing.length > 0) {
        setAiError("This signal was already saved for the current candle — duplicate skipped.");
        return;
      }

      const { error } = await supabase.from("signal_history").insert({
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

      if (error) throw new Error(error.message);
      setHistoryRefresh((k) => k + 1);
    } catch (err) {
      setAiError(
        `Signal not saved: ${err instanceof Error ? err.message : "database write failed"}. Your chart data is unaffected.`
      );
    }
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
      if (!effectiveIsPro && !isAdmin) {
        incrementScanCount();
        setRemainingScans(getRemainingScans());
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }, [effectiveIsPro, isAdmin]);

  const handleScanClick = useCallback(() => {
    setScanPanelOpen(true);
    if (scanResults.length === 0 && !scanning) {
      if (effectiveIsPro || isAdmin) runScan();
    }
  }, [effectiveIsPro, isAdmin, scanResults.length, scanning, runScan]);

  const handleFreeScan = useCallback(() => {
    if (effectiveIsPro || isAdmin || canScan()) runScan();
  }, [effectiveIsPro, isAdmin, runScan]);

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

  const showCoinBySymbol = useCallback((symbol: string) => {
    const coin = ALL_COINS.find((c) => c.symbol === symbol.toUpperCase());
    if (coin) {
      setSelectedCoin(coin);
    }
  }, []);

  const changePercent = priceChange ?? 0;
  const statsChange = marketStats?.priceChangePercent24h ?? changePercent;
  const tfLabel = TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? "1H";

  // Single top header Auto-Pilot toggle logic. Turning it on writes the server
  // flag; the browser never starts an execution loop again.
  const handleHeaderToggleAutoPilot = useCallback(async () => {
    if (!effectiveIsPro && !isAdmin) {
      setProModalOpen(true);
      return;
    }
    const nextState = !serverAutoPilot;
    const cfg = autoTradeEngine.getConfig();

    setAutoPilotSaving(true);
    setAutoPilotError(null);

    // Nothing local changes until the database confirms the write.
    try {
      await setServerAutoPilot(nextState, {
        marketType: cfg.marketType,
        leverage: cfg.leverage,
        riskPercent: cfg.riskPercent,
        maxOpenTrades: cfg.maxOpenTrades,
        tradeDirectionMode: cfg.tradeDirectionMode,
        symbols: AUTO_PILOT_SCAN_UNIVERSE.map((coin) => coin.binanceSymbol),
        paperTrading: cfg.paperTradingEnabled,
      });
    } catch (err) {
      setAutoPilotSaving(false);
      setAutoPilotError(
        `Could not ${nextState ? "enable" : "disable"} server Auto-Pilot: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
      setAutoPilotStatusText(
        serverAutoPilot
          ? "Status: Server Auto-Pilot armed — running 24/7 in the cloud"
          : "Status: Auto-Pilot Idle"
      );
      return;
    }

    setAutoPilotSaving(false);

    // Mirror the flag locally for display only; the execution loops stay disabled
    // because they check `serverAutoPilot` first.
    const updated = autoTradeEngine.saveConfig({ autoPilotEnabled: nextState });
    if (nextState) {
      autoPilotArmedTimestamp.current = Date.now();
      if (candles.length > 0) {
        lastProcessedCandleTimestamp.current = candles[candles.length - 1].time;
      }
    }
    setAutoPilotActive(updated.autoPilotEnabled);
    setAutoPilotError(null);
    setAutoPilotPauseReason(updated.autoPilotEnabled ? null : autoTradeEngine.getAutoPilotPauseReason());
    setAutoPilotStatusText(
      updated.autoPilotEnabled
        ? "Status: Server Auto-Pilot armed — running 24/7 in the cloud"
        : "Status: Auto-Pilot Idle"
    );
  }, [effectiveIsPro, isAdmin, candles, serverAutoPilot, setServerAutoPilot]);

  // Reflect the authoritative server flag in the header, even after a reload.
  useEffect(() => {
    if (autoTradeEngine.getConfig().autoPilotEnabled !== serverAutoPilot) {
      autoTradeEngine.saveConfig({ autoPilotEnabled: serverAutoPilot });
    }
    setAutoPilotActive(serverAutoPilot);
    if (!serverAutoPilot) setAutoPilotPauseReason(autoTradeEngine.getAutoPilotPauseReason());
    setAutoPilotStatusText(
      serverAutoPilot
        ? "Status: Server Auto-Pilot armed — running 24/7 in the cloud"
        : "Status: Auto-Pilot Idle"
    );
  }, [serverAutoPilot]);

  const inWatch = watchSymbols.has(selectedCoin.binanceSymbol);

  // Authentication gate: show full AuthScreen until signed in
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#070b14] flex flex-col items-center justify-center text-white font-mono space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        <span className="text-xs uppercase tracking-wider text-slate-400">Loading Fortress Terminal...</span>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col lg:flex-row pb-16 lg:pb-0">
      {/* Auto-Pilot save failure toast (the toggle has already been reverted) */}
      {autoPilotError && (
        <div
          role="alert"
          className="fixed bottom-20 lg:bottom-6 right-4 z-[70] max-w-sm px-4 py-3 rounded-xl bg-red-950 border border-red-500/70 text-red-200 text-xs font-semibold shadow-2xl flex items-start gap-2"
        >
          <span className="flex-1">{autoPilotError}</span>
          <button
            onClick={() => setAutoPilotError(null)}
            className="text-red-300 hover:text-white font-black px-1"
            aria-label="Dismiss Auto-Pilot error"
          >
            ×
          </button>
        </div>
      )}

      {/* Desktop sidebar with consolidated sections */}
      <aside className="hidden lg:flex flex-col w-60 border-r border-slate-800 bg-slate-950/90 shrink-0 sticky top-0 h-screen overflow-y-auto">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-bold tracking-tight leading-none">
              PatternHunter <span className="text-cyan-400">AI</span>
            </h1>
            <span className="text-[10px] text-slate-500 leading-none mt-1">Fortress Hedge Fund</span>
          </div>
        </div>

        {/* Consolidated Section Navigation */}
        <nav className="flex-1 p-3 space-y-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.groupTitle} className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 block font-mono">
                {group.groupTitle}
              </span>
              {group.items.map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      active
                        ? "bg-slate-800 text-cyan-300 border border-cyan-500/30"
                        : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${active ? "text-cyan-400" : ""}`} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* User Account / Admin Badge section */}
        <div className="px-3 py-2.5 border-t border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
              {user.email?.slice(0, 2).toUpperCase() ?? "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{user.email}</p>
              <p className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                {isAdmin ? (
                  <span className="text-[#00ff66] font-bold">Admin Mode</span>
                ) : effectiveIsPro ? (
                  <span className="text-amber-400 font-bold">Pro Trader</span>
                ) : (
                  <span>Free Tier</span>
                )}
              </p>
            </div>
            <button
              onClick={() => supabase.auth.signOut()}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-3 border-t border-slate-800 space-y-2">
          {/* Vision AI Chart Upload Button */}
          <button
            onClick={() => setVisionAIOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-bold transition-all shadow-md shadow-cyan-950/40"
          >
            <Eye className="w-4 h-4 text-slate-950" />
            Vision AI Upload
          </button>
          <button
            onClick={() => setAutoTradeOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-indigo-600 via-blue-600 to-cyan-600 hover:from-indigo-500 hover:to-blue-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-950/40"
          >
            <Zap className="w-4 h-4 text-yellow-300" />
            Auto-Trade Engine
          </button>
          <button
            onClick={handleScanClick}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium transition-colors"
          >
            <Radar className="w-4 h-4 text-cyan-400" />
            Scan Top 50
            {!effectiveIsPro && !isAdmin && <Crown className="w-3.5 h-3.5 text-amber-400 ml-auto" />}
          </button>

          {/* Trader Leaderboard Button */}
          <button
            onClick={() => setLeaderboardModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-300 transition-colors"
          >
            <Trophy className="w-4 h-4 text-amber-400" />
            Leaderboard & PnL
          </button>

          {/* Admin Mode Badge vs Go Pro Button */}
          {isAdmin ? (
            <button
              onClick={() => setAdminModalOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-[#00ff66] text-xs font-black uppercase tracking-wider shadow-lg shadow-emerald-950/40 font-mono transition-all"
              title="Open Enterprise Admin Management Console"
            >
              <span>👑 ADMIN PANEL</span>
            </button>
          ) : !effectiveIsPro && !subscriptionLoading ? (
            <button
              onClick={() => window.open("https://inamkhan08.gumroad.com/l/idbxpj", "_blank", "noopener,noreferrer")}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 text-xs font-bold transition-all shadow-md shadow-amber-950/30"
            >
              <Crown className="w-4 h-4" />
              Go Pro
            </button>
          ) : (
            <div className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-bold uppercase tracking-wider font-mono">
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              Pro Active
            </div>
          )}

          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs text-slate-300 font-medium transition-colors"
          >
            <span className="flex items-center gap-2">
              <SettingsIcon className="w-4 h-4 text-cyan-400" />
              Settings
            </span>
            <Download className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-40 max-w-full overflow-hidden">
          <div className="px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 max-w-full">
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setIsDrawerOpen(true)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition"
                aria-label="Open side menu"
                title="Open Navigation Menu"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-sm font-bold tracking-tight whitespace-nowrap">
                PatternHunter <span className="text-cyan-400">AI</span>
              </h1>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap justify-end py-0.5">
              {/* Single Auto-Pilot Toggle on Mobile Header */}
              <button
                onClick={() => void handleHeaderToggleAutoPilot()}
                disabled={autoPilotSaving}
                aria-busy={autoPilotSaving}
                className={`px-2 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider flex items-center gap-1 border font-mono shrink-0 disabled:opacity-60 disabled:cursor-wait ${
                  autoPilotActive
                    ? "bg-emerald-500/20 text-[#00ff66] border-emerald-400 animate-pulse"
                    : "bg-red-500/10 text-red-400 border-red-500/40"
                }`}
              >
                {autoPilotSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Power className="w-3.5 h-3.5" />
                )}
                <span>{autoPilotSaving ? "SAVING…" : autoPilotActive ? "ON" : "OFF"}</span>
              </button>

              <button
                onClick={() => setVisionAIOpen(true)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors shrink-0"
                title="Vision AI Chart Upload"
              >
                <Eye className="w-3.5 h-3.5 text-white" />
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors shrink-0"
                title="Settings & Install PWA"
              >
                <SettingsIcon className="w-4 h-4 text-cyan-400" />
              </button>
              {isAdmin ? (
                <div className="px-2 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/50 text-[#00ff66] text-xs font-black flex items-center gap-1 font-mono shrink-0">
                  <span>👑 ADMIN</span>
                </div>
              ) : !effectiveIsPro ? (
                <button
                  onClick={() => window.open("https://inamkhan08.gumroad.com/l/idbxpj", "_blank", "noopener,noreferrer")}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 text-xs font-bold transition-all shrink-0 whitespace-nowrap"
                >
                  <Crown className="w-3.5 h-3.5" />
                  <span>Pro</span>
                </button>
              ) : (
                <div className="px-2 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-bold flex items-center gap-1 font-mono shrink-0">
                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                  <span>Pro</span>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Market ticker */}
        <MarketTicker />

        {/* Coin + timeframe selector bar (only on chart tab) */}
        {activeTab === "chart" && (
          <div className="border-b border-slate-800 bg-slate-900/50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap max-w-full py-1">
                <button
                  onClick={() => setIsDrawerOpen(true)}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors shrink-0"
                  aria-label="Open side menu"
                  title="Open Navigation Menu"
                >
                  <Menu className="w-4 h-4" />
                </button>
                {/* Coin selector with search */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => { setCoinDropdownOpen((v) => !v); setCoinSearch(""); }}
                    className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                  >
                    <div className="w-6 sm:w-7 h-6 sm:h-7 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                      {selectedCoin.symbol.slice(0, 3)}
                    </div>
                    <div className="text-left">
                      <span className="text-xs sm:text-sm font-semibold">
                        {selectedCoin.symbol}<span className="text-slate-500">/USDT</span>
                      </span>
                    </div>
                    <ChevronDown className={`w-3.5 sm:w-4 h-3.5 sm:h-4 text-slate-400 transition-transform ${coinDropdownOpen ? "rotate-180" : ""}`} />
                  </button>

                  {coinDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setCoinDropdownOpen(false)} />
                      <div className="absolute top-full mt-2 left-0 z-20 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-slate-800 border border-slate-700 shadow-2xl overflow-hidden">
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
                  className="p-2 sm:p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors shrink-0"
                  title={inWatch ? "Remove from watchlist" : "Add to watchlist"}
                >
                  <svg
                    className={`w-3.5 sm:w-4 h-3.5 sm:h-4 ${inWatch ? "text-amber-400 fill-amber-400" : "text-slate-400"}`}
                    fill={inWatch ? "currentColor" : "none"}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                </button>

                {/* Timeframe selector */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => setTfDropdownOpen((v) => !v)}
                    className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
                  >
                    <Clock className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-cyan-400" />
                    <span className="text-xs sm:text-sm font-semibold">{tfLabel}</span>
                    <ChevronDown className={`w-3.5 sm:w-4 h-3.5 sm:h-4 text-slate-400 transition-transform ${tfDropdownOpen ? "rotate-180" : ""}`} />
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
                <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-0.5 shrink-0">
                  <button
                    onClick={() => setChartType("candles")}
                    className={`p-1.5 sm:p-2 rounded-md transition-colors ${chartType === "candles" ? "bg-slate-700 text-cyan-400" : "text-slate-500 hover:text-slate-300"}`}
                    title="Candlestick view"
                  >
                    <ChartIcon className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                  </button>
                  <button
                    onClick={() => setChartType("line")}
                    className={`p-1.5 sm:p-2 rounded-md transition-colors ${chartType === "line" ? "bg-slate-700 text-cyan-400" : "text-slate-500 hover:text-slate-300"}`}
                    title="Line view"
                  >
                    <LineIcon className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 ml-auto flex-wrap sm:flex-nowrap max-w-full overflow-x-auto scrollbar-hide py-1">
                {lastPrice && (
                  <div className="flex items-baseline gap-2 shrink-0">
                    <span className="text-base sm:text-lg font-bold tracking-tight font-mono">{formatPrice(lastPrice)}</span>
                    <span className={`text-xs sm:text-sm font-medium flex items-center font-mono ${statsChange >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
                      {statsChange >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {statsChange >= 0 ? "+" : ""}{statsChange.toFixed(2)}%
                    </span>
                  </div>
                )}

                {/* Mobile Tools Dropdown Toggle (md:hidden) */}
                <div className="relative md:hidden shrink-0">
                  <button
                    onClick={() => setMobileToolsOpen((v) => !v)}
                    className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold text-xs flex items-center gap-1 transition"
                    title="Toggle System Tools & Badges"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Tools</span>
                  </button>

                  {mobileToolsOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMobileToolsOpen(false)} />
                      <div className="absolute left-0 top-full mt-2 z-40 w-64 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-3 space-y-2 font-mono text-xs">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                          <span className="text-[10px] uppercase font-bold text-slate-400">Trading Tools</span>
                          <span className={`text-[10px] ${streamAgeSec !== null && streamAgeSec <= 10 ? "text-emerald-400" : "text-amber-400"}`}>
                            {lastTickAt === null ? "CONNECTING" : streamAgeSec !== null && streamAgeSec <= 10 ? "LIVE" : "STALE"}
                          </span>
                        </div>

                        {/* Vision AI in Mobile Tools */}
                        <button
                          onClick={() => { setVisionAIOpen(true); setMobileToolsOpen(false); }}
                          className="w-full px-2.5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black text-xs uppercase flex items-center gap-2"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Vision AI Upload</span>
                        </button>

                        {/* AI Swarm in Mobile Tools */}
                        <button
                          onClick={() => { setSwarmOpen(true); setMobileToolsOpen(false); }}
                          className="w-full px-2.5 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 text-slate-950 font-black text-xs uppercase flex items-center gap-2"
                        >
                          <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                          <span>AI Swarm Debate</span>
                        </button>

                        {/* Exchange Switcher in Mobile Tools */}
                        <div className="pt-1">
                          <label className="text-[10px] text-slate-400 block mb-1">Exchange Router</label>
                          <select
                            value={currentExchange}
                            onChange={(e) => {
                              const nextEx = e.target.value as ExchangeId;
                              setCurrentExchange(nextEx);
                              setActiveExchange(nextEx);
                            }}
                            className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-700 text-cyan-300 font-bold outline-none cursor-pointer"
                          >
                            {SUPPORTED_EXCHANGES.map((ex) => (
                              <option key={ex.id} value={ex.id}>
                                {ex.name} API
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Execution Mode Badge in Mobile Tools */}
                        <div
                          onClick={() => { setAutoTradeOpen(true); setMobileToolsOpen(false); }}
                          className={`px-2 py-1.5 rounded border font-bold flex items-center justify-between cursor-pointer ${
                            isPaperMode
                              ? "bg-amber-500/10 text-amber-300 border-amber-500/40"
                              : "bg-red-500/15 text-red-300 border-red-500/50"
                          }`}
                        >
                          <span>MODE</span>
                          <span>{isPaperMode ? "🟡 PAPER" : `🔴 LIVE ${currentExchange.toUpperCase()}`}</span>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 pt-1">
                          <span className="flex items-center gap-1">
                            <Sparkles className="w-3 h-3 text-cyan-400" /> AI Edge
                          </span>
                          <span className="text-slate-400 font-bold">SERVER-SIDE</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Desktop Vision AI Button */}
                <button
                  onClick={() => setVisionAIOpen(true)}
                  className="hidden md:flex px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs uppercase tracking-wider items-center gap-1.5 shadow-md shadow-cyan-950/40 transition shrink-0"
                  title="Analyze Chart Screenshot with Gemini Vision AI"
                >
                  <Eye className="w-3.5 h-3.5 text-slate-950" />
                  <span>Vision AI</span>
                </button>

                {/* Multi-Exchange Switcher & System Status Badges (Desktop) */}
                <div className="hidden md:flex items-center gap-1.5 font-mono text-[10px] shrink-0">
                  {/* Exchange Selector Dropdown */}
                  <select
                    value={currentExchange}
                    onChange={(e) => {
                      const nextEx = e.target.value as ExchangeId;
                      setCurrentExchange(nextEx);
                      setActiveExchange(nextEx);
                    }}
                    className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-cyan-300 font-bold outline-none cursor-pointer hover:border-cyan-500"
                    title="Active Exchange Router"
                  >
                    {SUPPORTED_EXCHANGES.map((ex) => (
                      <option key={ex.id} value={ex.id}>
                        {ex.name} API
                      </option>
                    ))}
                  </select>

                  {/* Execution Mode Badge */}
                  <span
                    className={`px-2 py-1 rounded border font-bold flex items-center gap-1 cursor-pointer ${
                      isPaperMode
                        ? "bg-amber-500/10 text-amber-300 border-amber-500/40 shadow-sm shadow-amber-950/30"
                        : "bg-red-500/15 text-red-300 border-red-500/50 shadow-sm shadow-red-950/40 animate-pulse"
                    }`}
                    onClick={() => setAutoTradeOpen(true)}
                    title={isPaperMode ? "Running in virtual simulation (Demo Mode). Click to connect Exchange API." : "Live real-money order execution on Exchange API!"}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isPaperMode ? "bg-amber-400" : "bg-red-400"}`} />
                    {isPaperMode ? "🟡 PAPER TRADING" : `🔴 LIVE ${currentExchange.toUpperCase()}`}
                  </span>

                  {/* Stream Health (based on the age of the last real tick) */}
                  <span
                    className={`px-2 py-1 rounded border flex items-center gap-1 ${
                      lastTickAt !== null && streamAgeSec !== null && streamAgeSec <= 10
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                        : "bg-amber-500/10 border-amber-500/30 text-amber-300"
                    }`}
                    title={
                      lastTickAt === null
                        ? "Waiting for the Binance ticker stream"
                        : `Last tick received ${streamAgeSec ?? "?"}s ago`
                    }
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        lastTickAt !== null && streamAgeSec !== null && streamAgeSec <= 10
                          ? "bg-emerald-400 animate-pulse"
                          : "bg-amber-400"
                      }`}
                    />
                    <span>
                      {lastTickAt === null
                        ? "CONNECTING"
                        : streamAgeSec !== null && streamAgeSec <= 10
                          ? "STREAM LIVE"
                          : `STALE ${streamAgeSec ?? "?"}s`}
                    </span>
                  </span>

                  {/* AI Status Badge */}
                  <span
                    className="px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 flex items-center gap-1 cursor-default font-mono"
                    title="AI requests are proxied through the backend; live availability is reported per request"
                  >
                    <Sparkles className="w-3 h-3 text-cyan-400" />
                    <span>AI: SERVER</span>
                  </span>
                </div>

                {/* AI Swarm Debater Button on the Chart (Desktop) */}
                <button
                  onClick={() => setSwarmOpen(true)}
                  className="hidden md:flex px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-xs uppercase tracking-wider items-center gap-1.5 shadow-md shadow-emerald-950/40 transition shrink-0"
                  title="Launch 3-Agent AI Swarm Debate"
                >
                  <Sparkles className="w-3.5 h-3.5 fill-slate-950" />
                  <span>AI Swarm</span>
                </button>

                {/* Global Emergency STOP Kill Switch */}
                <button
                  onClick={async () => {
                    const confirmed = window.confirm(
                      "EMERGENCY KILL SWITCH ACTIVATED!\n\nThis will instantly halt Auto-Pilot, cancel all open orders, and close live/paper positions. Proceed?"
                    );
                    if (confirmed) {
                      const stopResult = await autoTradeEngine.emergencyStop();
                      // Settle paper positions too so the UI reflects a flat book.
                      tradeManager.closeAllTrades("KILL_SWITCH");
                      autoTradeEngine.setAutoPilotState(autoTradeEngine.getAutoPilotPauseReason() ? "PAUSED" : "IDLE");
                      setAutoPilotActive(false);
                      setAutoPilotPauseReason(autoTradeEngine.getAutoPilotPauseReason());
                      alert(
                        `Emergency stop triggered. ${stopResult.cancelledOrdersCount} order group(s) cancelled, ${stopResult.closedPositionsCount} position(s) closed. Auto-Pilot paused.` +
                          (stopResult.failures.length > 0
                            ? `\n\nATTENTION — these positions could not be closed automatically:\n${stopResult.failures.join("\n")}`
                            : "")
                      );
                    }
                  }}
                  className="px-2 sm:px-2.5 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/60 text-[#ff3344] font-black text-[11px] sm:text-xs uppercase tracking-wider flex items-center gap-1 sm:gap-1.5 transition font-mono shadow-sm shadow-red-950/40 shrink-0"
                  title="Global Emergency Kill Switch — Halts Auto-Pilot & cancels open orders"
                >
                  <Power className="w-3.5 h-3.5 text-red-400" />
                  <span>KILL SWITCH</span>
                </button>

                {/* ONE Prominent AUTO-PILOT Toggle Button in the Top Header */}
                <button
                  onClick={() => void handleHeaderToggleAutoPilot()}
                  disabled={autoPilotSaving}
                  aria-busy={autoPilotSaving}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-lg font-black text-[11px] sm:text-xs uppercase tracking-wider flex items-center gap-1.5 sm:gap-2 transition-all border font-mono shrink-0 disabled:opacity-60 disabled:cursor-wait ${
                    autoPilotActive
                      ? "bg-emerald-500/20 text-[#00ff66] border-emerald-400 shadow-[0_0_15px_rgba(0,255,102,0.4)] animate-pulse"
                      : "bg-red-500/10 text-red-400 border-red-500/50 hover:bg-red-500/20"
                  }`}
                  title={
                    autoPilotSaving
                      ? "Saving Auto-Pilot state to the server…"
                      : autoPilotActive
                        ? "Auto-Pilot is ON. Click to pause."
                        : "Auto-Pilot is OFF. Click to enable 24/7 server execution."
                  }
                >
                  {autoPilotSaving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Power className={`w-3.5 h-3.5 ${autoPilotActive ? "text-[#00ff66]" : "text-red-400"}`} />
                  )}
                  <span>
                    AUTO-PILOT: {autoPilotSaving ? "SAVING…" : autoPilotActive ? "ON" : "OFF"}
                  </span>
                </button>

                {autoPilotPauseReason && (
                  <span
                    className="px-2.5 py-1.5 rounded-lg bg-red-600/20 border border-red-500/70 text-red-300 font-black text-[11px] uppercase tracking-wider animate-pulse shrink-0"
                    title="Auto-Pilot halted itself for safety. Re-arm from the header once the issue is resolved."
                  >
                    Auto-Pilot Paused: {autoPilotPauseReason}
                  </span>
                )}

                {/* Real-Time Auto-Pilot Status Indicator */}
                <div
                  onClick={() => setAutoTradeOpen(true)}
                  className={`hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-mono text-[11px] font-bold cursor-pointer transition select-none shrink-0 ${
                    autoPilotActive
                      ? "bg-slate-900/90 text-cyan-300 border-cyan-500/40 hover:border-cyan-400"
                      : "bg-slate-900/50 text-slate-400 border-slate-800"
                  }`}
                  title="Click to open Auto-Trade Engine and review live diagnostic logs"
                >
                  <span className={`w-2 h-2 rounded-full ${autoPilotActive ? "bg-[#00ff66] animate-pulse" : "bg-slate-600"}`} />
                  <span className="truncate max-w-[220px]">{autoPilotStatusText}</span>
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/50 text-[#00ff66] font-black text-[10px] sm:text-xs uppercase tracking-wider shadow-md shadow-emerald-950/30 font-mono shrink-0">
                    <span>👑 ADMIN</span>
                  </div>
                )}
                <button
                  onClick={() => loadData(selectedCoin.binanceSymbol, timeframe)}
                  disabled={loading}
                  className="p-1.5 sm:p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors disabled:opacity-50 shrink-0"
                  title="Refresh data"
                >
                  <RefreshCw className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${loading ? "animate-spin" : ""}`} />
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
            <div className="px-4 sm:px-6 py-4 space-y-4">
              {chartError && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 flex items-start gap-2">
                  <Zap className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{chartError}</span>
                </div>
              )}
              {/* Main Chart and Optional Pattern Panel Grid */}
              <div className={`grid grid-cols-1 ${patternPanelOpen ? "lg:grid-cols-3" : "grid-cols-1"} gap-4`}>
                {/* Chart - min-height 500px or 60vh */}
                <div className={`${patternPanelOpen ? "lg:col-span-2" : "col-span-1"} rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col min-h-[500px] h-[60vh] lg:h-[65vh] shadow-xl`}>
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
                      {candles.length > 0 && <TrendIndicator candles={candles} />}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="hidden sm:block">
                        <FearGreedIndex />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-xs text-slate-500 hidden sm:inline">Live · Binance</span>
                      </div>
                      <button
                        onClick={() => setPatternPanelOpen((v) => !v)}
                        className="ml-2 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 font-medium transition flex items-center gap-1"
                        title={patternPanelOpen ? "Collapse Pattern Panel" : "Expand Pattern Panel"}
                      >
                        <span>{patternPanelOpen ? "Maximize Chart" : "Show Patterns"}</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 relative min-h-[420px]">
                    <CandlestickChart
                      candles={candles}
                      pattern={pattern}
                      symbol={selectedCoin.binanceSymbol}
                      timeframe={tfLabel}
                      loading={loading}
                      chartType={chartType}
                      fomoLocked={fomoLocked}
                      fomoRemainingSeconds={fomoRemainingSeconds}
                    />
                  </div>
                </div>

                {/* Pattern panel - collapsible or scrollable */}
                {patternPanelOpen && (
                  <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col min-h-[500px] h-[60vh] lg:h-[65vh] overflow-y-auto">
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
                      fomoLocked={fomoLocked}
                      fomoRemainingSeconds={fomoRemainingSeconds}
                      onOpenAutoTrade={() => setAutoTradeOpen(true)}
                    />
                  </div>
                )}
              </div>

              {/* Collapsible Lower Panels Section: Macro Radar & News Radar */}
              <div className="rounded-2xl bg-slate-900/60 border border-slate-800 overflow-hidden shadow-lg">
                <button
                  onClick={() => setLowerPanelsOpen((v) => !v)}
                  className="w-full px-5 py-3 bg-slate-900/90 hover:bg-slate-800/80 border-b border-slate-800 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300 transition"
                >
                  <div className="flex items-center gap-2">
                    <Radar className="w-4 h-4 text-cyan-400" />
                    <span>Macro Radar & AI News Sentiment Matrix</span>
                    <span className="text-[10px] font-normal text-slate-500 normal-case">
                      (Click to {lowerPanelsOpen ? "collapse" : "expand"})
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${lowerPanelsOpen ? "rotate-180" : ""}`} />
                </button>

                {lowerPanelsOpen && (
                  <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 max-h-[550px] overflow-y-auto">
                    <MacroWidget />
                    <NewsSentimentRadar />
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "journal" && (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
              <TradingJournal />
            </div>
          )}

          {/* New Active Positions & Trade History Tab */}
          {activeTab === "positions" && (
            <ActivePositions
              currentSymbol={selectedCoin.binanceSymbol}
              currentPrice={lastPrice}
            />
          )}

          {activeTab === "scanner" && (
            <MarketScanner
              timeframe={timeframe}
              onSelectCoin={selectCoinFromTab}
              watchlistSymbols={watchSymbols}
              onToggleWatch={toggleWatch}
              isPro={effectiveIsPro || isAdmin}
            />
          )}

          {activeTab === "watchlist" && watchlistError && (
            <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-3">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {watchlistError}
              </div>
            </div>
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

          {activeTab === "chat" && (
            <AIChat
              coin={selectedCoin}
              price={lastPrice}
              change24h={marketStats?.priceChangePercent24h ?? priceChange}
              rsi={rsiValue}
              trend={trendValue}
              pattern={pattern?.name ?? null}
              fearGreed={fearGreedValue}
              onShowCoin={showCoinBySymbol}
              dataTimestamp={
                candles.length > 0
                  ? candles[candles.length - 1].time > 1e11
                    ? candles[candles.length - 1].time
                    : candles[candles.length - 1].time * 1000
                  : null
              }
            />
          )}

          {activeTab === "grid" && (
            <div className="px-4 sm:px-6 py-4">
              <GridBotUI selectedCoin={selectedCoin} currentPrice={lastPrice || 0} />
            </div>
          )}

          {activeTab === "dca" && (
            <div className="px-4 sm:px-6 py-4">
              <DCABotUI selectedCoin={selectedCoin} currentPrice={lastPrice || 0} />
            </div>
          )}

          {activeTab === "copy" && (
            <CopyTradingTab />
          )}

          {activeTab === "strategy" && (
            <StrategyBuilder selectedCoin={selectedCoin} timeframe={timeframe} />
          )}

          {activeTab === "arbitrage" && (
            <ArbitrageTab />
          )}

          {activeTab === "backtest" && (
            <Backtesting coin={selectedCoin} timeframe={timeframe} />
          )}

          {activeTab === "depth" && (
            <OrderBook symbol={selectedCoin.binanceSymbol} />
          )}

          {activeTab === "portfolio" && (
            <div className="space-y-6">
              <Portfolio />
              <div className="max-w-7xl mx-auto px-4 sm:px-6">
                <PnLCalendar />
              </div>
            </div>
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
          {MOBILE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex flex-col items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg transition-colors ${
                  active ? "text-cyan-400 font-bold" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            );
          })}
          {/* Full navigation on every tab (watchlist, signals, journal, settings…) */}
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="flex flex-col items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Open all navigation"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* Anti-FOMO Alert Modal */}
      <AntiFOMOModal
        open={fomoModalOpen}
        onClose={() => setFomoModalOpen(false)}
        priceChange1h={priceChange1h}
        remainingSeconds={fomoRemainingSeconds}
        symbol={selectedCoin.symbol}
      />

      <AutoTradeModal
        open={autoTradeOpen}
        onClose={() => setAutoTradeOpen(false)}
        currentSymbol={selectedCoin.binanceSymbol}
        currentPrice={lastPrice}
        currentAtr={currentAtr || ((lastPrice ?? 100) * 0.02)}
      />
      <SwarmTerminal
        open={swarmOpen}
        onClose={() => setSwarmOpen(false)}
        symbol={selectedCoin.binanceSymbol}
        price={lastPrice}
        rsi={rsiValue}
        trend={trendValue}
        patternName={pattern?.name}
        patternDirection={pattern?.direction}
        fearGreed={fearGreedValue}
        dataTimestamp={
          candles.length > 0
            ? candles[candles.length - 1].time > 1e11
              ? candles[candles.length - 1].time
              : candles[candles.length - 1].time * 1000
            : null
        }
        onExecuteTrade={(_direction, _leverage) => {
          void _direction; void _leverage;
          setAutoTradeOpen(true);
        }}
      />
      {/* Pro Modal only accessible if NOT admin */}
      {!isAdmin && !subscriptionLoading && (
        <ProModal
          open={proModalOpen && !isAdmin && !subscriptionLoading}
          onClose={() => setProModalOpen(false)}
          isPro={effectiveIsPro}
          isAdmin={isAdmin}
        />
      )}
      <ScanPanel
        open={scanPanelOpen}
        onClose={() => setScanPanelOpen(false)}
        scanning={scanning}
        results={scanResults}
        error={scanError}
        isPro={effectiveIsPro || isAdmin}
        remainingScans={remainingScans}
        onSelectCoin={selectCoinFromScan}
        onFreeScan={handleFreeScan}
      />

      {/* Vision AI Chart Upload Modal */}
      <VisionAIUpload
        open={visionAIOpen}
        onClose={() => setVisionAIOpen(false)}
        activeSymbol={selectedCoin.binanceSymbol}
      />

      {/* System Settings & PWA Installation Modal */}
      <SettingsModal
        open={settingsOpen}
        isAdmin={isAdmin}
        onClose={() => setSettingsOpen(false)}
        onOpenAutoTrade={() => setAutoTradeOpen(true)}
        onOpenVisionAI={() => setVisionAIOpen(true)}
      />

      {/* Enterprise Admin Controls Modal */}
      <AdminModal
        open={adminModalOpen}
        onClose={() => setAdminModalOpen(false)}
        userEmail={user?.email}
      />

      {/* Verified Trader Leaderboard Modal */}
      <LeaderboardModal
        open={leaderboardModalOpen}
        onClose={() => setLeaderboardModalOpen(false)}
      />

      {/* Sleek Side Drawer Navigation */}
      <SideDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
      />
    </div>
  );
}
