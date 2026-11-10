import React, { useState, useEffect } from "react";
import {
  Repeat,
  Play,
  Square,
  TrendingUp,
  DollarSign,
  Clock,
  Layers,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Sliders,
  History,
  Zap,
} from "lucide-react";
import { dcaBotEngine, type DCABotConfig, type DCABotState } from "../lib/DCABot";
import { formatPrice } from "../lib/patterns";
import type { Coin } from "../types";

interface Props {
  selectedCoin: Coin;
  currentPrice: number;
}

export default function DCABotUI({ selectedCoin, currentPrice }: Props) {
  const [botState, setBotState] = useState<DCABotState>(() => dcaBotEngine.getState());

  // DCA Parameters Form
  const [strategyType, setStrategyType] = useState<"RECURRING" | "SAFETY_ORDER_DIP">("SAFETY_ORDER_DIP");
  const [baseOrderUsd, setBaseOrderUsd] = useState<number>(50);
  const [safetyOrdersCount, setSafetyOrdersCount] = useState<number>(4);
  const [priceDeviationStepPct, setPriceDeviationStepPct] = useState<number>(2.5);
  const [volumeScaleMultiplier, setVolumeScaleMultiplier] = useState<number>(1.5);
  const [recurringIntervalMinutes, setRecurringIntervalMinutes] = useState<number>(60);
  const [takeProfitPct, setTakeProfitPct] = useState<number>(3.0);
  const [stopLossPct, setStopLossPct] = useState<number>(15);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = dcaBotEngine.subscribe((state) => {
      setBotState(state);
    });
    return () => unsub();
  }, []);

  const handleStartBot = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (currentPrice <= 0) {
      setErrorMessage("Waiting for live price feed before starting DCA bot...");
      return;
    }

    const config: DCABotConfig = {
      symbol: selectedCoin.binanceSymbol,
      strategyType,
      baseOrderUsd,
      safetyOrdersCount,
      priceDeviationStepPct,
      volumeScaleMultiplier,
      recurringIntervalMinutes,
      takeProfitPct,
      stopLossPct: stopLossPct > 0 ? stopLossPct : undefined,
    };

    const result = dcaBotEngine.startBot(config, currentPrice);
    if (!result.success) {
      setErrorMessage(result.error || "Failed to start DCA bot.");
    } else {
      setSuccessMessage(`DCA Bot active on ${selectedCoin.symbol}! Executing base order.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    }
  };

  const handleStopBot = () => {
    dcaBotEngine.stopBot();
    setSuccessMessage("DCA Bot stopped. Unfilled safety orders cancelled.");
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 font-mono space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl bg-[#090d16] border border-cyan-500/30 p-5 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Repeat className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black text-white uppercase tracking-wider">
                INSTITUTIONAL DCA BOT // DOLLAR-COST AVERAGING ENGINE
              </h1>
              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                botState.isActive
                  ? "bg-emerald-500/20 text-[#00ff66] border border-emerald-500/40 animate-pulse"
                  : "bg-slate-800 text-slate-400 border border-slate-700"
              }`}>
                {botState.isActive ? "ACTIVE & RUNNING" : "STOPPED / STANDBY"}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-sans mt-0.5">
              Automated dip accumulation with martingale volume scaling and dynamic weighted take-profit targets.
            </p>
          </div>
        </div>

        {/* Global DCA Stats */}
        <div className="flex items-center gap-4 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs w-full md:w-auto justify-between">
          <div>
            <span className="text-[10px] text-slate-500 uppercase block">TOTAL INVESTED</span>
            <span className="text-sm font-bold text-cyan-400">${botState.totalInvestedUsd.toFixed(2)}</span>
          </div>
          <div className="border-l border-slate-800 pl-4">
            <span className="text-[10px] text-slate-500 uppercase block">UNREALIZED PNL</span>
            <span className={`text-sm font-bold ${botState.unrealizedPnlUsd >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
              {botState.unrealizedPnlUsd >= 0 ? "+" : ""}${botState.unrealizedPnlUsd.toFixed(2)} ({botState.unrealizedPnlPct}%)
            </span>
          </div>
          <div className="border-l border-slate-800 pl-4">
            <span className="text-[10px] text-slate-500 uppercase block">REALIZED PROFIT</span>
            <span className="text-sm font-bold text-[#00ff66]">
              +${botState.totalRealizedPnlUsd.toFixed(2)} ({botState.completedCycles} Cycles)
            </span>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-[#00ff66] text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#00ff66] shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Main Grid: Parameters Form & Live Active Bot Tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* DCA Configuration Form */}
        <div className="rounded-2xl bg-[#090d16] border border-slate-800 p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              DCA Strategy Setup
            </span>
            <span className="text-xs font-bold text-cyan-400">{selectedCoin.symbol}/USDT</span>
          </div>

          <form onSubmit={handleStartBot} className="space-y-4 text-xs font-sans">
            {/* Strategy Mode Toggle */}
            <div>
              <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                Strategy Modality
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setStrategyType("SAFETY_ORDER_DIP")}
                  className={`py-2 px-3 rounded-lg font-mono font-bold text-xs uppercase border transition ${
                    strategyType === "SAFETY_ORDER_DIP"
                      ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50"
                      : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
                  }`}
                >
                  Martingale Dip DCA
                </button>
                <button
                  type="button"
                  onClick={() => setStrategyType("RECURRING")}
                  className={`py-2 px-3 rounded-lg font-mono font-bold text-xs uppercase border transition ${
                    strategyType === "RECURRING"
                      ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50"
                      : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
                  }`}
                >
                  Timed Recurring
                </button>
              </div>
            </div>

            {/* Base Order Size */}
            <div>
              <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                Base Order Amount (USDT)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono">$</span>
                <input
                  type="number"
                  min="10"
                  step="5"
                  value={baseOrderUsd}
                  onChange={(e) => setBaseOrderUsd(Number(e.target.value) || 10)}
                  disabled={botState.isActive}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-white font-mono font-bold outline-none focus:border-cyan-500 disabled:opacity-50"
                />
              </div>
            </div>

            {strategyType === "SAFETY_ORDER_DIP" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                      Safety Orders Count
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={safetyOrdersCount}
                      onChange={(e) => setSafetyOrdersCount(Number(e.target.value) || 1)}
                      disabled={botState.isActive}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono font-bold outline-none focus:border-cyan-500 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                      Dip Step Size (%)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={priceDeviationStepPct}
                      onChange={(e) => setPriceDeviationStepPct(Number(e.target.value) || 1)}
                      disabled={botState.isActive}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono font-bold outline-none focus:border-cyan-500 disabled:opacity-50"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                    Volume Multiplier Scale ({volumeScaleMultiplier}x)
                  </label>
                  <input
                    type="range"
                    min="1.0"
                    max="2.5"
                    step="0.1"
                    value={volumeScaleMultiplier}
                    onChange={(e) => setVolumeScaleMultiplier(Number(e.target.value))}
                    disabled={botState.isActive}
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                    <span>1.0x (Flat)</span>
                    <span>1.5x (Recommended)</span>
                    <span>2.5x (Aggressive)</span>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                  Recurring Interval
                </label>
                <select
                  value={recurringIntervalMinutes}
                  onChange={(e) => setRecurringIntervalMinutes(Number(e.target.value))}
                  disabled={botState.isActive}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono outline-none focus:border-cyan-500 disabled:opacity-50"
                >
                  <option value={15}>Every 15 Minutes</option>
                  <option value={60}>Every 1 Hour</option>
                  <option value={240}>Every 4 Hours</option>
                  <option value={720}>Every 12 Hours</option>
                  <option value={1440}>Every 24 Hours (Daily)</option>
                </select>
              </div>
            )}

            {/* Target Take Profit */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
              <div>
                <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                  Take Profit (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.5"
                    min="1"
                    value={takeProfitPct}
                    onChange={(e) => setTakeProfitPct(Number(e.target.value) || 1)}
                    disabled={botState.isActive}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[#00ff66] font-mono font-bold outline-none focus:border-cyan-500 disabled:opacity-50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono">%</span>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-mono uppercase text-slate-400 block mb-1">
                  Stop Loss (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="1"
                    min="5"
                    value={stopLossPct}
                    onChange={(e) => setStopLossPct(Number(e.target.value) || 10)}
                    disabled={botState.isActive}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[#ff3344] font-mono font-bold outline-none focus:border-cyan-500 disabled:opacity-50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono">%</span>
                </div>
              </div>
            </div>

            {/* Launch or Stop Button */}
            <div className="pt-2">
              {botState.isActive ? (
                <button
                  type="button"
                  onClick={handleStopBot}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-mono font-bold text-xs uppercase tracking-wider transition shadow-lg shadow-red-950/40"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>STOP ACTIVE DCA BOT</span>
                </button>
              ) : (
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-mono font-black text-xs uppercase tracking-wider transition shadow-lg shadow-emerald-950/40"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>START DCA BOT EXECUTION</span>
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Live Active Bot Status & Safety Order Dip Ladder */}
        <div className="lg:col-span-2 space-y-5">
          {/* Active Bot Summary Card */}
          <div className="rounded-2xl bg-[#090d16] border border-slate-800 p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Live DCA Position Tracker
              </span>
              <span className="text-xs font-mono text-slate-400">
                Live Price: <b className="text-white">${formatPrice(currentPrice)}</b>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase block">AVG ENTRY COST</span>
                <span className="text-sm font-bold text-cyan-400 font-mono">
                  ${formatPrice(botState.currentAveragePrice || currentPrice)}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase block">COINS ACCUMULATED</span>
                <span className="text-sm font-bold text-white font-mono">
                  {botState.totalQuantity.toFixed(4)} {selectedCoin.symbol}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase block">TARGET TAKE PROFIT</span>
                <span className="text-sm font-bold text-[#00ff66] font-mono">
                  ${formatPrice(
                    botState.currentAveragePrice
                      ? botState.currentAveragePrice * (1 + (botState.config?.takeProfitPct || 3) / 100)
                      : currentPrice * 1.03
                  )}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-[10px] text-slate-500 uppercase block">CURRENT VALUATION</span>
                <span className="text-sm font-bold text-amber-400 font-mono">
                  ${botState.totalCurrentValueUsd.toFixed(2)} USDT
                </span>
              </div>
            </div>

            {/* Dip Ladder / Safety Orders Table */}
            {botState.safetyOrders.length > 0 && (
              <div className="space-y-2 pt-2">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Safety Order Dip Execution Ladder
                </span>
                <div className="space-y-1.5">
                  {botState.safetyOrders.map((so) => (
                    <div
                      key={so.orderIndex}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition ${
                        so.status === "FILLED"
                          ? "bg-emerald-950/40 border-emerald-500/40 text-[#00ff66]"
                          : "bg-slate-950 border-slate-800 text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          so.status === "FILLED" ? "bg-emerald-500/20 text-[#00ff66]" : "bg-slate-800 text-slate-400"
                        }`}>
                          SO #{so.orderIndex} (-{so.priceDeviationPct}%)
                        </span>
                        <span className="font-bold font-mono">${formatPrice(so.triggerPrice)}</span>
                      </div>
                      <div className="flex items-center gap-4 font-mono text-[11px]">
                        <span>${so.amountUsd.toFixed(0)} USDT</span>
                        <span className={so.status === "FILLED" ? "text-[#00ff66] font-bold" : "text-amber-400"}>
                          {so.status === "FILLED" ? "✓ FILLED" : "PENDING DIP"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Execution History */}
          <div className="rounded-2xl bg-[#090d16] border border-slate-800 p-5 shadow-xl space-y-3">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 border-b border-slate-800 pb-2">
              <History className="w-4 h-4 text-cyan-400" />
              DCA Cycle Execution History
            </span>

            {botState.executionHistory.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-3 font-sans">No DCA orders executed yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {botState.executionHistory.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-950 border border-slate-800/80 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                        item.type === "TAKE_PROFIT"
                          ? "bg-emerald-500/20 text-[#00ff66]"
                          : item.type === "STOP_LOSS"
                          ? "bg-red-500/20 text-[#ff3344]"
                          : "bg-cyan-500/20 text-cyan-300"
                      }`}>
                        {item.type}
                      </span>
                      <span className="font-mono text-slate-300">${formatPrice(item.price)}</span>
                    </div>

                    <div className="flex items-center gap-3 font-mono text-[11px]">
                      <span className="text-slate-400">${item.amountUsd.toFixed(2)} USDT</span>
                      {item.pnl !== undefined && (
                        <span className={`font-bold ${item.pnl >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
                          {item.pnl >= 0 ? "+" : ""}${item.pnl.toFixed(2)}
                        </span>
                      )}
                      <span className="text-slate-500 text-[10px]">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
