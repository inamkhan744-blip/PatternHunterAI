import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  Percent,
  Layers,
  ArrowRightLeft,
  Lock,
} from "lucide-react";
import {
  autoTradeEngine,
  calculatePositionSize,
  calculateLiquidationPrice,
  checkLiquidationProximity,
  calculateAtrStopLoss,
  MarketType,
  TradeDirection,
  AutoTradeConfig,
  ManagedTrade,
  CircuitBreakerState,
} from "../lib/BinanceAutoTrade";
import { formatPrice } from "../lib/patterns";
import RiskDisclaimerModal from "./RiskDisclaimerModal";

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
  const [config, setConfig] = useState<AutoTradeConfig>(autoTradeEngine.getConfig());
  const [circuitBreaker, setCircuitBreaker] = useState<CircuitBreakerState>(autoTradeEngine.getCircuitBreaker());
  const [openTrades, setOpenTrades] = useState<ManagedTrade[]>(autoTradeEngine.getOpenTrades());
  const [accountBalance, setAccountBalance] = useState<number>(10000);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);

  // Sync state on modal open
  useEffect(() => {
    if (open) {
      const cfg = autoTradeEngine.getConfig();
      setConfig(cfg);
      setCircuitBreaker(autoTradeEngine.getCircuitBreaker());
      setOpenTrades(autoTradeEngine.getOpenTrades());
      loadBalance(cfg.marketType);
    }
  }, [open]);

  // Periodic trade evaluator simulation
  useEffect(() => {
    if (!open || !currentPrice) return;
    const interval = setInterval(() => {
      autoTradeEngine.evaluateOpenTrades(currentPrice, currentSymbol);
      setOpenTrades(autoTradeEngine.getOpenTrades());
      setCircuitBreaker(autoTradeEngine.getCircuitBreaker());
    }, 3000);
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
    if (!config.disclaimerAgreed) {
      setDisclaimerOpen(true);
      return;
    }
    if (circuitBreaker.isTripped) {
      setStatusMessage({
        type: "error",
        text: "Circuit Breaker is tripped! Please reset the circuit breaker before re-enabling Auto-Pilot.",
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

  // Immediate trade execution (Limit Order)
  const handleExecuteNow = async () => {
    if (!currentPrice) {
      setStatusMessage({ type: "error", text: "Current market price is unavailable." });
      return;
    }
    if (!config.disclaimerAgreed) {
      setDisclaimerOpen(true);
      return;
    }
    setExecuting(true);
    setStatusMessage(null);
    try {
      const result = await autoTradeEngine.executeTrade({
        symbol: currentSymbol,
        entryPrice: currentPrice,
        atrValue: currentAtr,
        direction: config.marketType === "Futures" ? config.direction : "LONG",
        marketType: config.marketType,
        accountBalance,
      });

      if (result.success && result.trade) {
        setStatusMessage({
          type: "success",
          text: `LIMIT Order placed: ${result.trade.marketType} ${result.trade.direction} ${result.trade.quantity} ${result.trade.symbol} @ ${formatPrice(result.trade.entryPrice)}`,
        });
        setOpenTrades(autoTradeEngine.getOpenTrades());
      } else {
        setStatusMessage({
          type: "error",
          text: result.error || "Order execution failed.",
        });
      }
    } finally {
      setExecuting(false);
    }
  };

  // Rule 3: Massive Emergency Stop Kill Switch
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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
        <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-white">
          {/* Top Bar */}
          <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 via-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-amber-950/50">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-white tracking-wide">
                    Fortress Auto-Trade Engine
                  </h2>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                    Binance Spot & Futures
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Quantitative Risk Management & Algorithm Execution
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
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
                  ? "bg-green-500/15 border-green-500/30 text-green-300"
                  : statusMessage.type === "error"
                  ? "bg-red-500/15 border-red-500/30 text-red-300"
                  : "bg-cyan-500/15 border-cyan-500/30 text-cyan-300"
              }`}
            >
              <div className="flex items-center gap-2">
                {statusMessage.type === "success" && <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />}
                {statusMessage.type === "error" && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
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

          {/* Circuit Breaker Alert Banner */}
          {circuitBreaker.isTripped && (
            <div className="px-6 py-3 bg-red-950/80 border-b border-red-500 flex items-center justify-between">
              <div className="flex items-center gap-2 text-red-400 text-xs font-bold">
                <Flame className="w-4 h-4 animate-bounce" />
                <span>
                  CIRCUIT BREAKER TRIPPED ({circuitBreaker.consecutiveLosses} consecutive losses). Auto-Pilot halted to prevent drawdown.
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
            {/* Top Control Grid: Market Type & AutoPilot Master Switch */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Market Selection */}
              <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-3">
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
                <p className="text-[11px] text-slate-500">
                  {config.marketType === "Futures"
                    ? "Supports Long & Short derivatives with 1x-10x margin."
                    : "Standard asset exchange with no margin or liquidation risk."}
                </p>
              </div>

              {/* Futures Direction & Leverage Controls */}
              <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-3">
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
                    {/* Direction Toggle */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleConfigChange({ direction: "LONG" })}
                        className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold border transition ${
                          config.direction === "LONG"
                            ? "bg-green-500 text-slate-950 border-green-400"
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
                            ? "bg-red-500 text-white border-red-400"
                            : "bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-700"
                        }`}
                      >
                        <TrendingDown className="w-3.5 h-3.5" />
                        SHORT
                      </button>
                    </div>

                    {/* Leverage Slider (1x to 10x) */}
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
                  <div className="h-full flex items-center justify-center text-xs text-slate-500 text-center py-4">
                    Spot trading operates in 1x Long-only mode without borrowing.
                  </div>
                )}
              </div>

              {/* Master Auto-Pilot Toggle */}
              <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Power className="w-3.5 h-3.5 text-green-400" />
                    Auto-Pilot
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      config.autoPilotEnabled
                        ? "bg-green-500/20 text-green-400 border border-green-500/40"
                        : "bg-slate-700 text-slate-400"
                    }`}
                  >
                    {config.autoPilotEnabled ? "ACTIVE" : "DISABLED"}
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  Automates limit order entries on pattern confirmations while obeying ATR stops and the 2-loss circuit breaker.
                </p>

                <button
                  onClick={handleToggleAutoPilot}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition ${
                    config.autoPilotEnabled
                      ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                      : "bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-slate-950 shadow-lg shadow-green-950/40"
                  }`}
                >
                  <Power className="w-4 h-4" />
                  {config.autoPilotEnabled ? "Disable Auto-Pilot" : "Enable Auto-Pilot"}
                </button>
              </div>
            </div>

            {/* Fortress Risk & Order Management Parameters */}
            <div className="p-5 rounded-xl bg-slate-800/40 border border-slate-700 space-y-4">
              <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Fortress Risk Controls & Position Parameters
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Max Open Trades (1-3) */}
                <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
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
                            : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1.5">Enforces hard cap (1–3 concurrent trades).</p>
                </div>

                {/* Risk % per trade */}
                <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
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
                    className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <p className="text-[10px] text-slate-500 mt-1.5">Compounds position value with leverage.</p>
                </div>

                {/* ATR Stop Loss */}
                <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-medium text-slate-400">
                      ATR Stop Loss
                    </label>
                    <span className="text-xs font-bold text-red-400">
                      {config.atrMultiplier}x ATR
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs py-1 text-slate-300 font-mono">
                    <span>Target SL:</span>
                    <span className="text-red-400 font-bold">1.5x ATR</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">Adaptive volatility-based stop boundary.</p>
                </div>

                {/* Profit Vault & Trailing SL Switches */}
                <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
                  {/* Profit Vault 50% */}
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-[11px] text-slate-300 font-medium">Profit Vault (50%)</span>
                    <input
                      type="checkbox"
                      checked={config.profitVaultEnabled}
                      onChange={(e) => handleConfigChange({ profitVaultEnabled: e.target.checked })}
                      className="w-4 h-4 rounded text-cyan-500 bg-slate-950 border-slate-700"
                    />
                  </label>
                  {/* Trailing SL at 1:1 RR */}
                  <label className="flex items-center justify-between cursor-pointer mt-2">
                    <span className="text-[11px] text-slate-300 font-medium">BE Trailing at 1:1 RR</span>
                    <input
                      type="checkbox"
                      checked={config.trailingSlEnabled}
                      onChange={(e) => handleConfigChange({ trailingSlEnabled: e.target.checked })}
                      className="w-4 h-4 rounded text-cyan-500 bg-slate-950 border-slate-700"
                    />
                  </label>
                  <p className="text-[10px] text-slate-500 mt-1.5">Vault sends 50% profit to Spot; moves SL to BE at 1:1 RR.</p>
                </div>
              </div>
            </div>

            {/* Calculations & Liquidation Safety Warning */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Order Sizing Preview */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700 space-y-3">
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
                    <div className="bg-slate-900/80 p-2.5 rounded-lg">
                      <span className="text-[10px] text-slate-500 block uppercase">Quantity</span>
                      <span className="text-xs font-bold text-cyan-400 font-mono">
                        {positionPreview.quantity} {currentSymbol.replace("USDT", "")}
                      </span>
                    </div>
                    <div className="bg-slate-900/80 p-2.5 rounded-lg">
                      <span className="text-[10px] text-slate-500 block uppercase">Notional</span>
                      <span className="text-xs font-bold text-white font-mono">
                        ${positionPreview.positionValue.toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-slate-900/80 p-2.5 rounded-lg">
                      <span className="text-[10px] text-slate-500 block uppercase">Margin</span>
                      <span className="text-xs font-bold text-amber-400 font-mono">
                        ${positionPreview.marginRequired.toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
                  <span>Entry Mechanism:</span>
                  <span className="font-bold text-green-400">LIMIT ORDER (Zero Slippage)</span>
                </div>
              </div>

              {/* Liquidation & Stop Loss Monitor */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700 space-y-3">
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
                  <div className="bg-slate-900/80 p-2.5 rounded-lg">
                    <span className="text-[10px] text-slate-500 block uppercase">1.5x ATR SL</span>
                    <span className="text-xs font-bold text-red-400 font-mono">
                      {atrPreview ? formatPrice(atrPreview.stopLossPrice) : "—"}
                    </span>
                  </div>
                  <div className="bg-slate-900/80 p-2.5 rounded-lg">
                    <span className="text-[10px] text-slate-500 block uppercase">
                      {config.marketType === "Futures" ? "Liquidation Price" : "Risk Level"}
                    </span>
                    <span className="text-xs font-bold text-orange-400 font-mono">
                      {liquidationPreview ? formatPrice(liquidationPreview.liquidationPrice) : "N/A (Spot)"}
                    </span>
                  </div>
                </div>

                {/* Prominent Liquidation Proximity Warning */}
                {liquidationPreview?.proximity.isTooClose && (
                  <div className="p-2.5 rounded-lg bg-red-950/90 border border-red-500/80 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5 animate-pulse" />
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
                <div className="p-6 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-500">
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
                              ? "bg-green-500/20 text-green-400"
                              : "bg-red-500/20 text-red-400"
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
                          <span className={trade.trailingSlTriggered ? "text-cyan-400 font-bold" : "text-red-400"}>
                            {formatPrice(trade.stopLossPrice)}
                            {trade.trailingSlTriggered && " (BE)"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block">TP Target</span>
                          <span className="text-green-400">{formatPrice(trade.takeProfitPrice)}</span>
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

            {/* API Credentials Input (Optional / Expandable) */}
            <div className="p-4 rounded-xl bg-slate-950/50 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5 text-amber-400" />
                  Binance API Keys (Live Execution)
                </span>
                <span className="text-[10px] text-slate-500">
                  Leave blank for Sandbox Simulation
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="password"
                  placeholder="Binance API Key"
                  value={config.apiKey}
                  onChange={(e) => handleConfigChange({ apiKey: e.target.value })}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 outline-none focus:border-cyan-500"
                />
                <input
                  type="password"
                  placeholder="Binance API Secret"
                  value={config.apiSecret}
                  onChange={(e) => handleConfigChange({ apiSecret: e.target.value })}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </div>

          {/* Bottom Action Footer with Massive Emergency Stop */}
          <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            {/* Rule 3: MASSIVE RED 'EMERGENCY STOP' KILL SWITCH BUTTON */}
            <button
              onClick={handleEmergencyStop}
              disabled={emergencyLoading}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-widest shadow-xl shadow-red-950/80 border-2 border-red-400 hover:border-red-300 transition-all flex items-center justify-center gap-2 animate-pulse active:scale-95"
            >
              <Flame className="w-5 h-5 text-yellow-300" />
              EMERGENCY STOP (KILL SWITCH)
            </button>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {/* Trigger Single Trade Button */}
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

      {/* Risk Disclaimer Modal */}
      <RiskDisclaimerModal
        open={disclaimerOpen}
        onClose={() => setDisclaimerOpen(false)}
        onAgree={handleDisclaimerAgreed}
      />
    </>
  );
}
