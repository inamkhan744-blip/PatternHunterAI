import React, { useState, useEffect, useMemo } from "react";
import {
  Shield,
  Zap,
  Sliders,
  AlertTriangle,
  Flame,
  CheckCircle,
  XCircle,
  Key,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Power,
  X,
  Target,
  Send,
  Lock,
  Crown,
  Layers,
  ArrowRightLeft,
} from "lucide-react";
import {
  autoTradeEngine,
  calculatePositionSize,
  calculateLiquidationPrice,
  checkLiquidationProximity,
  calculateAtrStopLoss,
  MarketType,
  AutoTradeConfig,
  ManagedTrade,
  CircuitBreakerState,
} from "../lib/BinanceAutoTrade";
import { paperTradingEngine, PaperTrade } from "../lib/PaperTrading";
import { formatPrice } from "../lib/patterns";
import RiskDisclaimerModal from "./RiskDisclaimerModal";
import { useAuth } from "../lib/auth";
import {
  isUserAdmin,
  isUserPro,
  getProDailyTradeLimit,
  setProDailyTradeLimit,
  getDailyTradeCount,
  checkTradeExecutionAllowance,
  ProDailyTradeLimit,
  FREE_DAILY_MANUAL_TRADE_LIMIT,
} from "../lib/SubscriptionManager";
import {
  loadTelegramConfig,
  saveTelegramConfig,
  sendTelegramAlert,
  TelegramConfig,
} from "../lib/TelegramService";

interface Props {
  open: boolean;
  onClose: () => void;
  currentSymbol: string;
  currentPrice: number | null;
  currentAtr: number;
}

export default function AutoTradeModal({
  open,
  onClose,
  currentSymbol,
  currentPrice,
  currentAtr,
}: Props) {
  const { user } = useAuth();
  const isAdmin = useMemo(() => isUserAdmin(user?.email), [user?.email]);
  const isPro = useMemo(() => isUserPro(user?.email, false), [user?.email]);

  const [config, setConfig] = useState<AutoTradeConfig>(autoTradeEngine.getConfig());
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerState>(autoTradeEngine.getCircuitBreaker());
  const [openTrades, setOpenTrades] = useState<ManagedTrade[]>(autoTradeEngine.getOpenTrades());
  const [paperTrades, setPaperTrades] = useState<PaperTrade[]>(paperTradingEngine.getOpenTrades());
  const [accountBalance, setAccountBalance] = useState<number>(10000);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);

  // Pro & Limit States
  const [proTradeLimit, setLimitState] = useState<ProDailyTradeLimit>(getProDailyTradeLimit());
  const [dailyTradeCount, setDailyTradeCount] = useState<number>(getDailyTradeCount());

  // Telegram State
  const [telegramConfig, setTgConfig] = useState<TelegramConfig>(loadTelegramConfig());
  const [telegramTesting, setTelegramTesting] = useState(false);

  // Sync state on modal open
  useEffect(() => {
    if (open) {
      const cfg = autoTradeEngine.getConfig();
      setConfig(cfg);
      setCircuitBreaker(autoTradeEngine.getCircuitBreaker());
      setOpenTrades(autoTradeEngine.getOpenTrades());
      setPaperTrades(paperTradingEngine.getOpenTrades());
      setTgConfig(loadTelegramConfig());
      setLimitState(getProDailyTradeLimit());
      setDailyTradeCount(getDailyTradeCount());
      const cd = autoTradeEngine.getPostLossCooldown();
      setCooldownRemaining(cd.remainingSeconds);
      loadBalance(cfg.marketType);
    }
  }, [open]);

  // Periodic trade evaluator simulation & Cooldown countdown
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      if (currentPrice) {
        autoTradeEngine.evaluateOpenTrades(currentPrice, currentSymbol);
        paperTradingEngine.evaluatePrice(currentPrice, currentSymbol);
        setOpenTrades(autoTradeEngine.getOpenTrades());
        setPaperTrades(paperTradingEngine.getOpenTrades());
        setCircuitBreaker(autoTradeEngine.getCircuitBreaker());
        setDailyTradeCount(getDailyTradeCount());
      }
      const cd = autoTradeEngine.getPostLossCooldown();
      setCooldownRemaining(cd.remainingSeconds);
    }, 1000);
    return () => clearInterval(interval);
  }, [open, currentPrice, currentSymbol]);

  const loadBalance = async (marketType: MarketType) => {
    setBalanceLoading(true);
    try {
      const bal = await autoTradeEngine.fetchAccountBalance(marketType);
      setAccountBalance(bal.freeBalance);
    } finally {
      setBalanceLoading(false);
    }
  };

  const handleConfigChange = (updates: Partial<AutoTradeConfig>) => {
    const updated = autoTradeEngine.saveConfig(updates);
    setConfig({ ...updated });
    if (updates.marketType) {
      loadBalance(updates.marketType);
    }
  };

  const handleToggleAutoPilot = () => {
    if (!isPro && !isAdmin) {
      setStatusMessage({
        type: "error",
        text: "Auto-Pilot is locked for Free users. Upgrade to Pro or authenticate with admin bypass.",
      });
      return;
    }
    if (!config.disclaimerAgreed) {
      setDisclaimerOpen(true);
      return;
    }
    if (circuitBreaker.isTripped) {
      setStatusMessage({
        type: "error",
        text: "Circuit Breaker is tripped! Please reset the circuit breaker before re-enabling God-Mode Auto-Pilot.",
      });
      return;
    }
    const cd = autoTradeEngine.getPostLossCooldown();
    if (cd.isActive) {
      setStatusMessage({
        type: "error",
        text: `Post-Loss Cooldown is active (${Math.ceil(cd.remainingSeconds / 60)}m remaining). Auto-Pilot cannot be engaged during cooldown.`,
      });
      return;
    }
    const nextState = !config.autoPilotEnabled;
    handleConfigChange({ autoPilotEnabled: nextState });
    setStatusMessage({
      type: "info",
      text: nextState ? "Auto-Pilot ACTIVE: trades will execute automatically on signals." : "Auto-Pilot PAUSED.",
    });
  };

  const handleDisclaimerAgreed = () => {
    handleConfigChange({ disclaimerAgreed: true });
    setStatusMessage({
      type: "success",
      text: "Risk Disclaimer acknowledged. You can now enable Auto-Trade.",
    });
  };

  const handleResetCircuitBreaker = () => {
    autoTradeEngine.resetCircuitBreaker();
    setCircuitBreaker(autoTradeEngine.getCircuitBreaker());
    setStatusMessage({
      type: "info",
      text: "Circuit Breaker reset. Capital protection cleared.",
    });
  };

  const handleTelegramChange = (updates: Partial<TelegramConfig>) => {
    const updated = saveTelegramConfig(updates);
    setTgConfig(updated);
  };

  const handleTestTelegram = async () => {
    setTelegramTesting(true);
    try {
      const res = await sendTelegramAlert("🚀 <b>[FORTRESS TEST]</b> Telegram Bot Integration Active and Verified!");
      if (res.success) {
        setStatusMessage({ type: "success", text: "Test Telegram notification sent successfully!" });
      } else {
        setStatusMessage({ type: "error", text: `Telegram Alert failed: ${res.error}` });
      }
    } finally {
      setTelegramTesting(false);
    }
  };

  const handleDailyLimitChange = (val: ProDailyTradeLimit) => {
    setProDailyTradeLimit(val);
    setLimitState(val);
    setStatusMessage({ type: "info", text: `Pro daily trade limit set to ${val} trades/day.` });
  };

  // Immediate trade execution (Limit Order)
  const handleExecuteNow = async () => {
    if (!currentPrice) {
      setStatusMessage({ type: "error", text: "Current market price is unavailable." });
      return;
    }

    const check = checkTradeExecutionAllowance(user?.email, isPro);
    if (!check.allowed) {
      setStatusMessage({ type: "error", text: check.reason || "Daily trade limit reached." });
      return;
    }

    if (!config.disclaimerAgreed) {
      setDisclaimerOpen(true);
      return;
    }

    setExecuting(true);
    setStatusMessage(null);
    try {
      if (config.paperTradingEnabled) {
        // Execute Paper Trade
        const pResult = paperTradingEngine.executeOrder({
          symbol: currentSymbol,
          entryPrice: currentPrice,
          atrValue: currentAtr,
          direction: config.marketType === "Futures" ? config.direction : "LONG",
          marketType: config.marketType,
          leverage: config.leverage,
          riskPercent: config.riskPercent,
        });

        if (pResult.success && pResult.trade) {
          setStatusMessage({
            type: "success",
            text: `[PAPER TRADE] Virtual Order Executed: ${pResult.trade.marketType} ${pResult.trade.direction} ${pResult.trade.quantity} ${pResult.trade.symbol} @ ${formatPrice(pResult.trade.entryPrice)}`,
          });
          setPaperTrades(paperTradingEngine.getOpenTrades());
        } else {
          setStatusMessage({
            type: "error",
            text: pResult.error || "Paper trade execution failed.",
          });
        }
      } else {
        // Execute Real/Sandbox Engine Trade with God-Mode Checks
        const result = await autoTradeEngine.executeTrade({
          symbol: currentSymbol,
          entryPrice: currentPrice,
          atrValue: currentAtr,
          direction: config.marketType === "Futures" ? config.direction : "LONG",
          marketType: config.marketType,
          accountBalance,
          userEmail: user?.email,
          isPro,
        });

        if (result.success && result.trade) {
          setStatusMessage({
            type: "success",
            text: `LIMIT Order placed: ${result.trade.marketType} ${result.trade.direction} ${result.trade.quantity} ${result.trade.symbol} @ ${formatPrice(result.trade.entryPrice)}`,
          });
          setOpenTrades(autoTradeEngine.getOpenTrades());
          setDailyTradeCount(getDailyTradeCount());
        } else {
          setStatusMessage({
            type: "error",
            text: result.error || "Order execution failed.",
          });
        }
      }
    } finally {
      setExecuting(false);
    }
  };

  const handleEmergencyStop = async () => {
    if (!confirm("🚨 ACTIVATE KILL SWITCH? This will immediately cancel ALL open orders on Binance Spot and Futures and close all active positions!")) {
      return;
    }
    setEmergencyLoading(true);
    try {
      const res = await autoTradeEngine.emergencyStop();
      setOpenTrades(autoTradeEngine.getOpenTrades());
      setConfig(autoTradeEngine.getConfig());
      setStatusMessage({
        type: "error",
        text: `EMERGENCY KILL SWITCH ENGAGED: Cancelled ${res.cancelledOrdersCount} orders, terminated ${res.closedPositionsCount} positions. Auto-Pilot DISABLED.`,
      });
    } finally {
      setEmergencyLoading(false);
    }
  };

  // Position Sizing Preview
  const positionPreview = useMemo(() => {
    if (!currentPrice || currentPrice <= 0) return null;
    const lev = config.marketType === "Futures" ? config.leverage : 1;
    return calculatePositionSize(config.riskPercent, accountBalance, lev, currentPrice);
  }, [config.riskPercent, accountBalance, config.leverage, config.marketType, currentPrice]);

  // ATR SL & TP Preview
  const atrPreview = useMemo(() => {
    if (!currentPrice || currentPrice <= 0) return null;
    const dir = config.marketType === "Futures" ? config.direction : "LONG";
    return calculateAtrStopLoss(currentPrice, currentAtr, dir, config.atrMultiplier);
  }, [currentPrice, currentAtr, config.direction, config.marketType, config.atrMultiplier]);

  // Liquidation Price & Proximity Warning
  const liquidationPreview = useMemo(() => {
    if (config.marketType !== "Futures" || !currentPrice || !atrPreview) return null;
    const liq = calculateLiquidationPrice(currentPrice, config.leverage, config.direction);
    const proximity = checkLiquidationProximity(atrPreview.stopLossPrice, liq.liquidationPrice, config.direction, currentPrice);
    return {
      liquidationPrice: liq.liquidationPrice,
      distancePercent: liq.distancePercent,
      proximity,
    };
  }, [config.marketType, currentPrice, config.leverage, config.direction, atrPreview]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
        <div className="relative w-full max-w-4xl bg-[#090d16] border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-950/50 overflow-hidden flex flex-col max-h-[92vh] text-white font-mono">
          {/* Top Bar - Bloomberg Terminal Style */}
          <div className="px-6 py-4 border-b border-slate-800 bg-[#060910] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 via-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-amber-950/50">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white tracking-wider uppercase">
                    FORTRESS HEDGE FUND // EXECUTION TERMINAL
                  </h2>
                  {isAdmin ? (
                    <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                      <Crown className="w-3 h-3 text-amber-400" /> ADMIN BYPASS ACTIVE
                    </span>
                  ) : isPro ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/40">
                      PRO TIER ACTIVE
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 border border-slate-600">
                      FREE TIER
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 font-sans">
                  AES-256 Vault-Secured Binance Engine & Telegram Signal Dispatch
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Daily Trade Limit status */}
              <div className="text-right hidden sm:block">
                <span className="text-[10px] text-slate-500 block uppercase">Daily Trades Executed</span>
                <span className="text-xs font-bold text-cyan-400">
                  {dailyTradeCount} / {isAdmin ? "UNLIMITED" : isPro ? proTradeLimit : FREE_DAILY_MANUAL_TRADE_LIMIT}
                </span>
              </div>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Status Notification */}
          {statusMessage && (
            <div
              className={`px-6 py-2.5 text-xs font-semibold flex items-center justify-between border-b ${
                statusMessage.type === "success"
                  ? "bg-green-500/15 border-green-500/30 text-[#00ff66]"
                  : statusMessage.type === "error"
                  ? "bg-red-500/15 border-red-500/30 text-[#ff3344]"
                  : "bg-cyan-500/15 border-cyan-500/30 text-cyan-300"
              }`}
            >
              <div className="flex items-center gap-2">
                {statusMessage.type === "success" && <CheckCircle className="w-4 h-4 text-[#00ff66] shrink-0" />}
                {statusMessage.type === "error" && <XCircle className="w-4 h-4 text-[#ff3344] shrink-0" />}
                {statusMessage.type === "info" && <Zap className="w-4 h-4 text-cyan-400 shrink-0" />}
                <span>{statusMessage.text}</span>
              </div>
              <button
                onClick={() => setStatusMessage(null)}
                className="text-slate-400 hover:text-white ml-2 text-xs"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Post-Loss Cooldown Banner */}
          {cooldownRemaining > 0 && (
            <div className="px-6 py-2.5 bg-amber-950/80 border-b border-amber-500/60 flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
                <AlertTriangle className="w-4 h-4 animate-pulse text-amber-400" />
                <span>
                  POST-LOSS COOLDOWN ACTIVE: {Math.floor(cooldownRemaining / 60)}m {cooldownRemaining % 60}s remaining. New orders temporarily blocked.
                </span>
              </div>
              <button
                onClick={() => {
                  autoTradeEngine.clearPostLossCooldown();
                  setCooldownRemaining(0);
                }}
                className="px-2.5 py-1 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/50 text-amber-200 rounded text-[11px] font-bold transition"
              >
                Override Cooldown
              </button>
            </div>
          )}

          {/* Circuit Breaker Alert Banner */}
          {circuitBreaker.isTripped && (
            <div className="px-6 py-3 bg-red-950/80 border-b border-red-500 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#ff3344] text-xs font-bold">
                <Flame className="w-4 h-4 animate-bounce" />
                <span>
                  CIRCUIT BREAKER TRIPPED ({circuitBreaker.reason || `${circuitBreaker.consecutiveLosses} consecutive losses`}). Auto-Pilot halted.
                </span>
              </div>
              <button
                onClick={handleResetCircuitBreaker}
                className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold transition shadow-sm"
              >
                Reset Breaker
              </button>
            </div>
          )}

          {/* Main Scrollable Body */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            {/* Pro User Controls / Free Limitations Bar */}
            <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Execution Quota:</span>
                <span className="font-bold text-white">
                  {dailyTradeCount} of {isAdmin ? "∞" : isPro ? proTradeLimit : FREE_DAILY_MANUAL_TRADE_LIMIT} trades used today
                </span>
              </div>

              {/* Pro Dropdown for Daily Trade Limit */}
              {isPro || isAdmin ? (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">Daily Trade Limit:</span>
                  <select
                    value={proTradeLimit}
                    onChange={(e) => handleDailyLimitChange(Number(e.target.value) as ProDailyTradeLimit)}
                    className="bg-slate-950 border border-cyan-500/40 rounded-lg px-2.5 py-1 text-cyan-300 font-bold outline-none focus:border-cyan-400"
                  >
                    <option value={1}>1 Trade / Day</option>
                    <option value={5}>5 Trades / Day</option>
                    <option value={10}>10 Trades / Day</option>
                    <option value={100}>100 Trades / Day (Enterprise)</option>
                  </select>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-slate-500 text-[11px]">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Free users limited to 3 manual trades/day. Auto-Pilot & Telegram locked.</span>
                </div>
              )}
            </div>

            {/* God-Mode AI Safety Checklist Strip */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-[#0b1220] to-[#090d16] border border-cyan-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-2">
                  <Shield className="w-4 h-4 text-cyan-400" />
                  "God-Mode" AI Institutional Risk Shield (Zero-Error Guard)
                </span>
                <span className="text-[10px] font-bold text-[#00ff66] bg-[#00ff66]/10 px-2 py-0.5 rounded border border-[#00ff66]/30">
                  6/6 SHIELDS ACTIVE
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1 text-[11px]">
                <div className="p-2 rounded bg-slate-950/70 border border-slate-800 text-slate-300">
                  <span className="block text-[10px] text-slate-500">1. Cooldown</span>
                  <span className="font-bold text-[#00ff66]">30m Post-Loss</span>
                </div>
                <div className="p-2 rounded bg-slate-950/70 border border-slate-800 text-slate-300">
                  <span className="block text-[10px] text-slate-500">2. Swarm Veto</span>
                  <span className="font-bold text-[#00ff66]">Risk Mgr NO-GO</span>
                </div>
                <div className="p-2 rounded bg-slate-950/70 border border-slate-800 text-slate-300">
                  <span className="block text-[10px] text-slate-500">3. Confluence</span>
                  <span className="font-bold text-[#00ff66]">85 to 95+ ATR</span>
                </div>
                <div className="p-2 rounded bg-slate-950/70 border border-slate-800 text-slate-300">
                  <span className="block text-[10px] text-slate-500">4. Global Filter</span>
                  <span className="font-bold text-[#00ff66]">BTC 1H RSI &gt;30</span>
                </div>
                <div className="p-2 rounded bg-slate-950/70 border border-slate-800 text-slate-300">
                  <span className="block text-[10px] text-slate-500">5. Spread Guard</span>
                  <span className="font-bold text-[#00ff66]">&le; 0.1% Spread</span>
                </div>
                <div className="p-2 rounded bg-slate-950/70 border border-slate-800 text-slate-300">
                  <span className="block text-[10px] text-slate-500">6. Max Loss</span>
                  <span className="font-bold text-amber-400">{config.maxDailyLossPercent || 3}% Breaker</span>
                </div>
              </div>
            </div>

            {/* Paper Trading Mode Toggle & Max Daily Loss % Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Paper Trading Mode Bar */}
              <div className="p-4 rounded-xl bg-[#0d121f] border border-amber-500/30 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                      Paper Trading Mode
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${config.paperTradingEnabled ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-slate-800 text-slate-400"}`}>
                      {config.paperTradingEnabled ? "VIRTUAL $10,000 ACTIVE" : "REAL API MODE"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                    Test strategies in realistic zero-risk simulated sandbox.
                  </p>
                </div>
                <button
                  onClick={() => handleConfigChange({ paperTradingEnabled: !config.paperTradingEnabled })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                    config.paperTradingEnabled
                      ? "bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-950/50"
                      : "bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800"
                  }`}
                >
                  {config.paperTradingEnabled ? "Disable Paper" : "Enable Paper"}
                </button>
              </div>

              {/* Max Daily Loss % Setting */}
              <div className="p-4 rounded-xl bg-[#0d121f] border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                      Max Daily Loss Circuit Breaker
                    </span>
                    <span className="text-xs font-mono font-bold text-[#ff3344]">
                      {config.maxDailyLossPercent || 3.0}%
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                    Auto-Pilot kills active trades and shuts off if daily drawdown hits this threshold.
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {[2, 3, 5].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => handleConfigChange({ maxDailyLossPercent: pct })}
                      className={`px-2.5 py-1 rounded text-xs font-bold transition ${
                        (config.maxDailyLossPercent || 3) === pct
                          ? "bg-red-500 text-white"
                          : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Top Control Grid: Market Type & AutoPilot Master Switch */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Market Selection */}
              <div className="p-4 rounded-xl bg-[#0d121f] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
                    Market Target
                  </span>
                  <span className="text-xs font-bold text-cyan-400">
                    {config.marketType}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleConfigChange({ marketType: "Spot" })}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition ${
                      config.marketType === "Spot"
                        ? "bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-950/50"
                        : "bg-slate-900/80 text-slate-400 border-slate-700 hover:bg-slate-700"
                    }`}
                  >
                    Spot API
                  </button>
                  <button
                    onClick={() => handleConfigChange({ marketType: "Futures" })}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition ${
                      config.marketType === "Futures"
                        ? "bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-950/50"
                        : "bg-slate-900/80 text-slate-400 border-slate-700 hover:bg-slate-700"
                    }`}
                  >
                    Futures API
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 font-sans">
                  {config.marketType === "Futures"
                    ? "Supports Long & Short derivatives with 1x-10x margin."
                    : "Standard asset exchange with no margin or liquidation risk."}
                </p>
              </div>

              {/* Futures Direction & Leverage Controls */}
              <div className="p-4 rounded-xl bg-[#0d121f] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-amber-400" />
                    {config.marketType === "Futures" ? "Futures Setup" : "Spot Mode"}
                  </span>
                  {config.marketType === "Futures" && (
                    <span className="text-xs font-bold text-amber-400">
                      {config.leverage}x Leverage
                    </span>
                  )}
                </div>

                {config.marketType === "Futures" ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleConfigChange({ direction: "LONG" })}
                        className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold border transition ${
                          config.direction === "LONG"
                            ? "bg-[#00ff66] text-slate-950 border-green-400"
                            : "bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-700"
                        }`}
                      >
                        <TrendingUp className="w-3.5 h-3.5" />
                        LONG
                      </button>
                      <button
                        onClick={() => handleConfigChange({ direction: "SHORT" })}
                        className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold border transition ${
                          config.direction === "SHORT"
                            ? "bg-[#ff3344] text-white border-red-400"
                            : "bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-700"
                        }`}
                      >
                        <TrendingDown className="w-3.5 h-3.5" />
                        SHORT
                      </button>
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                        <span>Leverage (1x - 10x)</span>
                        <span className="font-bold text-amber-300">{config.leverage}x</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={config.leverage}
                        onChange={(e) => handleConfigChange({ leverage: parseInt(e.target.value, 10) })}
                        className="w-full accent-amber-500 h-1.5 bg-slate-900 rounded-lg cursor-pointer"
                      />
                    </div>
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-slate-500 text-center py-4 font-sans">
                    Spot trading operates in 1x Long-only mode without borrowing.
                  </div>
                )}
              </div>

              {/* Master Auto-Pilot Toggle (Locked for Free Users) */}
              <div className="p-4 rounded-xl bg-[#0d121f] border border-slate-800 flex flex-col justify-between space-y-3 relative overflow-hidden">
                {!isPro && !isAdmin && (
                  <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center p-4 text-center">
                    <Lock className="w-6 h-6 text-amber-400 mb-1" />
                    <span className="text-xs font-bold text-amber-300 uppercase">Auto-Pilot Locked</span>
                    <span className="text-[10px] text-slate-400 mt-1 font-sans">Available exclusively for Pro Subscribers & Admin</span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Power className="w-3.5 h-3.5 text-green-400" />
                    Auto-Pilot
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      config.autoPilotEnabled
                        ? "bg-green-500/20 text-[#00ff66] border border-green-500/40"
                        : "bg-slate-700 text-slate-400"
                    }`}
                  >
                    {config.autoPilotEnabled ? "ACTIVE" : "DISABLED"}
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed font-sans">
                  Automates limit order entries on pattern confirmations while obeying ATR stops and the 2-loss circuit breaker.
                </p>

                <button
                  onClick={handleToggleAutoPilot}
                  disabled={!isPro && !isAdmin}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition ${
                    config.autoPilotEnabled
                      ? "bg-red-500/20 text-[#ff3344] border border-red-500/50 hover:bg-red-500/30"
                      : "bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 shadow-lg shadow-green-950/40"
                  }`}
                >
                  <Power className="w-4 h-4" />
                  {config.autoPilotEnabled ? "Disable Auto-Pilot" : "Enable Auto-Pilot"}
                </button>
              </div>
            </div>

            {/* Telegram Bot Alert Integration - HIDDEN FOR FREE USERS */}
            {(isPro || isAdmin) && (
              <div className="p-5 rounded-xl bg-[#0b101c] border border-cyan-500/30 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
                    <Send className="w-4 h-4 text-cyan-400" />
                    Telegram Bot Alert Dispatch (Pro Enterprise)
                  </h3>
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <span>Enable Telegram Broadcasts</span>
                    <input
                      type="checkbox"
                      checked={telegramConfig.enabled}
                      onChange={(e) => handleTelegramChange({ enabled: e.target.checked })}
                      className="w-4 h-4 accent-cyan-500"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase">Telegram Bot Token</label>
                    <input
                      type="password"
                      placeholder="e.g. 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                      value={telegramConfig.botToken}
                      onChange={(e) => handleTelegramChange({ botToken: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-700 outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase">Telegram Chat ID / Channel ID</label>
                    <input
                      type="text"
                      placeholder="e.g. 987654321 or -100123456789"
                      value={telegramConfig.chatId}
                      onChange={(e) => handleTelegramChange({ chatId: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-700 outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleTestTelegram}
                    disabled={telegramTesting || !telegramConfig.botToken || !telegramConfig.chatId}
                    className="px-4 py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {telegramTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Send Test Telegram Alert
                  </button>
                </div>
              </div>
            )}

            {/* Fortress Risk & Order Management Parameters */}
            <div className="p-5 rounded-xl bg-[#0d121f] border border-slate-800 space-y-4">
              <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Fortress Risk Controls & Position Parameters
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Max Open Trades (1-3) */}
                <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-medium text-slate-400">
                      Max Open Trades
                    </label>
                    <span className="text-xs font-bold text-cyan-400">
                      {config.maxOpenTrades}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((val) => (
                      <button
                        key={val}
                        onClick={() => handleConfigChange({ maxOpenTrades: val })}
                        className={`flex-1 py-1.5 rounded text-xs font-bold transition ${
                          config.maxOpenTrades === val
                            ? "bg-cyan-500 text-slate-950"
                            : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1.5 font-sans">Enforces hard cap (1–3 concurrent trades).</p>
                </div>

                {/* Risk % per trade */}
                <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-medium text-slate-400">
                      Risk Per Trade
                    </label>
                    <span className="text-xs font-bold text-amber-400">
                      {config.riskPercent}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="5.0"
                    step="0.5"
                    value={config.riskPercent}
                    onChange={(e) => handleConfigChange({ riskPercent: parseFloat(e.target.value) })}
                    className="w-full accent-amber-500 h-1.5 bg-slate-900 rounded-lg cursor-pointer"
                  />
                  <p className="text-[10px] text-slate-500 mt-1.5 font-sans">Compounds position value with leverage.</p>
                </div>

                {/* ATR Stop Loss */}
                <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-medium text-slate-400">
                      ATR Stop Loss
                    </label>
                    <span className="text-xs font-bold text-[#ff3344]">
                      {config.atrMultiplier}x ATR
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs py-1 text-slate-300 font-mono">
                    <span>Target SL:</span>
                    <span className="text-[#ff3344] font-bold">1.5x ATR</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 font-sans">Adaptive volatility-based stop boundary.</p>
                </div>

                {/* Profit Vault & Trailing SL Switches */}
                <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[11px] text-slate-300 font-medium">Profit Vault (50%)</span>
                    <input
                      type="checkbox"
                      checked={config.profitVaultEnabled}
                      onChange={(e) => handleConfigChange({ profitVaultEnabled: e.target.checked })}
                      className="w-4 h-4 rounded text-cyan-500 bg-slate-950 border-slate-700"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer mt-2">
                    <span className="text-[11px] text-slate-300 font-medium">BE Trailing at 1:1 RR</span>
                    <input
                      type="checkbox"
                      checked={config.trailingSlEnabled}
                      onChange={(e) => handleConfigChange({ trailingSlEnabled: e.target.checked })}
                      className="w-4 h-4 rounded text-cyan-500 bg-slate-950 border-slate-700"
                    />
                  </label>
                  <p className="text-[10px] text-slate-500 mt-1.5 font-sans">Vault sweeps 50% profit to Spot; moves SL to BE at 1:1 RR.</p>
                </div>
              </div>
            </div>

            {/* Calculations & Liquidation Safety Warning */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-[#0d121f] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-cyan-400" />
                    Auto-Compounded Order Sizing
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Bal: ${accountBalance.toFixed(2)}
                  </span>
                </div>

                {positionPreview && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Quantity</span>
                      <span className="text-xs font-bold text-cyan-400 font-mono">
                        {positionPreview.quantity} {currentSymbol.replace("USDT", "")}
                      </span>
                    </div>
                    <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Notional</span>
                      <span className="text-xs font-bold text-white font-mono">
                        ${positionPreview.positionValue.toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-500 block uppercase">Margin</span>
                      <span className="text-xs font-bold text-amber-400 font-mono">
                        ${positionPreview.marginRequired.toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 font-mono">
                  <span>Entry Mechanism:</span>
                  <span className="font-bold text-[#00ff66]">LIMIT ORDER (Zero Slippage)</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0d121f] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-red-400" />
                    Liquidation & Stop Loss Boundaries
                  </span>
                  {currentPrice && (
                    <span className="text-xs font-mono text-slate-400">
                      Price: {formatPrice(currentPrice)}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-500 block uppercase">1.5x ATR SL</span>
                    <span className="text-xs font-bold text-[#ff3344] font-mono">
                      {atrPreview ? formatPrice(atrPreview.stopLossPrice) : "—"}
                    </span>
                  </div>
                  <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-500 block uppercase">
                      {config.marketType === "Futures" ? "Liquidation Price" : "Risk Level"}
                    </span>
                    <span className="text-xs font-bold text-orange-400 font-mono">
                      {liquidationPreview ? formatPrice(liquidationPreview.liquidationPrice) : "N/A (Spot)"}
                    </span>
                  </div>
                </div>

                {liquidationPreview?.proximity.isTooClose && (
                  <div className="p-2.5 rounded-lg bg-red-950/90 border border-red-500/80 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#ff3344] shrink-0 mt-0.5 animate-pulse" />
                    <p className="text-[11px] font-bold text-red-300 leading-snug">
                      {liquidationPreview.proximity.warningMessage}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Active Managed Trades & Kill Switch Area */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  Active Managed Positions ({openTrades.length}/{config.maxOpenTrades})
                </h3>

                <span className="text-xs text-slate-400">
                  Vault Locked: <strong className="text-cyan-400 font-mono">${autoTradeEngine.getProfitVaultTotal().toFixed(2)}</strong>
                </span>
              </div>

              {openTrades.length === 0 ? (
                <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-500 font-sans">
                  No active trades currently open. New trades will enter via LIMIT order upon pattern verification.
                </div>
              ) : (
                <div className="space-y-2">
                  {openTrades.map((trade) => (
                    <div
                      key={trade.id}
                      className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-3 text-xs flex-wrap"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                            trade.direction === "LONG"
                              ? "bg-green-500/20 text-[#00ff66]"
                              : "bg-red-500/20 text-[#ff3344]"
                          }`}
                        >
                          {trade.direction} {trade.leverage}x
                        </span>
                        <span className="font-semibold text-white">{trade.symbol}</span>
                        <span className="text-slate-500 font-mono">qty: {trade.quantity}</span>
                      </div>

                      <div className="flex items-center gap-4 text-slate-300 font-mono">
                        <div>
                          <span className="text-[10px] text-slate-500 block">Entry (LIMIT)</span>
                          <span>{formatPrice(trade.entryPrice)}</span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">Current SL</span>
                          <span className={trade.trailingSlTriggered ? "text-cyan-400 font-bold" : "text-[#ff3344]"}>
                            {formatPrice(trade.stopLossPrice)}
                            {trade.trailingSlTriggered && " (BE)"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">TP Target</span>
                          <span className="text-[#00ff66]">{formatPrice(trade.takeProfitPrice)}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          if (currentPrice) {
                            autoTradeEngine.closeTrade(trade.id, currentPrice, "MANUAL");
                            setOpenTrades(autoTradeEngine.getOpenTrades());
                          }
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold transition"
                      >
                        Close
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* API Credentials Input with AES-256 Protection */}
            <div className="p-4 rounded-xl bg-[#0b101c] border border-cyan-500/20 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 uppercase">
                  <Key className="w-3.5 h-3.5 text-amber-400" />
                  Binance API Keys (AES-256 Encrypted Storage)
                </span>
                <span className="text-[10px] text-[#00ff66] font-bold">
                  ● AES-256 ENCRYPTION ACTIVE
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="password"
                  placeholder="Binance API Key"
                  value={config.apiKey}
                  onChange={(e) => handleConfigChange({ apiKey: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 outline-none focus:border-cyan-500 font-mono"
                />
                <input
                  type="password"
                  placeholder="Binance API Secret"
                  value={config.apiSecret}
                  onChange={(e) => handleConfigChange({ apiSecret: e.target.value })}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 outline-none focus:border-cyan-500 font-mono"
                />
              </div>
              <p className="text-[10px] text-slate-500 font-sans">
                Keys are encrypted client-side using AES-256 prior to persisting to browser storage. Leave empty to use simulation sandbox mode.
              </p>
            </div>
          </div>

          {/* Bottom Action Footer with Massive Emergency Stop */}
          <div className="px-6 py-4 bg-[#060910] border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              onClick={handleEmergencyStop}
              disabled={emergencyLoading}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-widest shadow-xl shadow-red-950/80 border-2 border-red-400 hover:border-red-300 transition-all flex items-center justify-center gap-2 animate-pulse active:scale-95"
            >
              <Flame className="w-5 h-5 text-yellow-300" />
              EMERGENCY STOP (KILL SWITCH)
            </button>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                onClick={handleExecuteNow}
                disabled={executing || !currentPrice}
                className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs uppercase tracking-wider transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {executing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 text-slate-950" />
                )}
                Place Limit Entry
              </button>

              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

      <RiskDisclaimerModal
        open={disclaimerOpen}
        onClose={() => setDisclaimerOpen(false)}
        onAgree={handleDisclaimerAgreed}
      />
    </>
  );
}
