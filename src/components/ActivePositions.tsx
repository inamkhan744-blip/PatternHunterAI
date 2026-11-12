import React, { useState, useEffect, useMemo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Layers,
  History,
  XCircle,
  ShieldCheck,
  CheckCircle,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  tradeManager,
  ActiveTrade,
  ClosedTrade,
  TradeStats,
} from "../lib/TradeManager";
import { formatPrice } from "../lib/patterns";
import { isLiveTradingConfigured } from "../lib/CredentialVault";

interface Props {
  currentSymbol?: string;
  currentPrice?: number | null;
}

export default function ActivePositions({ currentSymbol, currentPrice }: Props) {
  const [subTab, setSubTab] = useState<"active" | "history">("active");
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>(() => tradeManager.getActiveTrades());
  const [tradeHistory, setTradeHistory] = useState<ClosedTrade[]>(() => tradeManager.getTradeHistory());
  const [stats, setStats] = useState<TradeStats>(() => tradeManager.getStats());

  // Real-money mode requires server-side encrypted credentials to exist.
  const hasValidBinanceKeys = useMemo(() => isLiveTradingConfigured(), []);

  useEffect(() => {
    const sync = () => {
      setActiveTrades(tradeManager.getActiveTrades());
      setTradeHistory(tradeManager.getTradeHistory());
      setStats(tradeManager.getStats());
    };

    const unsubscribe = tradeManager.subscribe(sync);
    sync();

    return () => {
      unsubscribe();
    };
  }, []);

  // Update live prices from current symbol/price props if available
  useEffect(() => {
    if (currentSymbol && currentPrice && currentPrice > 0) {
      tradeManager.updateLivePrice(currentSymbol, currentPrice);
    }
  }, [currentSymbol, currentPrice]);

  const [closeError, setCloseError] = useState<string | null>(null);

  const handleCloseTrade = async (trade: ActiveTrade) => {
    setCloseError(null);
    const { closed, error } = await tradeManager.closeTradeWithExchange(
      trade.id,
      trade.currentPrice,
      "MANUAL"
    );
    if (!closed) {
      setCloseError(error || "Could not close the position.");
    }
  };

  const handleCloseAll = async () => {
    if (activeTrades.length === 0) return;
    if (!confirm("Close all active open positions immediately at current market prices?")) return;
    setCloseError(null);
    const failures: string[] = [];
    for (const trade of activeTrades) {
      const { closed, error } = await tradeManager.closeTradeWithExchange(
        trade.id,
        trade.currentPrice,
        "MANUAL"
      );
      if (!closed) failures.push(`${trade.symbol}: ${error || "close failed"}`);
    }
    if (failures.length > 0) setCloseError(failures.join(" · "));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6 font-sans text-white">
      {closeError && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-xs text-red-200">
          {closeError}
        </div>
      )}
      {/* Top Header & Summary Stats */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-950/50">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black uppercase tracking-tight text-white font-mono flex items-center gap-2">
                Portfolio Command & Active Positions
              </h1>
              <p className="text-xs text-slate-400">
                Real-time tracking of institutional Spot & Futures positions
              </p>
            </div>
          </div>
        </div>

        {/* Sub-tab navigation */}
        <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-xl">
          <button
            onClick={() => setSubTab("active")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 font-mono ${
              subTab === "active"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Layers className="w-4 h-4" />
            Active Positions ({activeTrades.length})
          </button>
          <button
            onClick={() => setSubTab("history")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 font-mono ${
              subTab === "history"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <History className="w-4 h-4" />
            Trade History ({tradeHistory.length})
          </button>
        </div>
      </div>

      {/* Institutional Performance Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 font-mono">
        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <span className="text-[11px] text-slate-400 block uppercase font-sans">
            Total Closed Trades
          </span>
          <span className="text-2xl font-black text-white mt-1 block">
            {stats.totalTrades}
          </span>
          <span className="text-[10px] text-slate-500">
            {activeTrades.length} currently open
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <span className="text-[11px] text-slate-400 block uppercase font-sans">
            Win Rate
          </span>
          <span className={`text-2xl font-black mt-1 block ${stats.winRate >= 50 ? "text-[#00ff66]" : "text-amber-400"}`}>
            {stats.winRate.toFixed(1)}%
          </span>
          <span className="text-[10px] text-slate-500">
            {stats.wins}W / {stats.losses}L
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <span className="text-[11px] text-slate-400 block uppercase font-sans">
            Realized Net PnL
          </span>
          <span
            className={`text-2xl font-black mt-1 block ${
              stats.totalPnl >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"
            }`}
          >
            {stats.totalPnl >= 0 ? "+" : ""}${stats.totalPnl.toFixed(2)}
          </span>
          <span className="text-[10px] text-slate-500">
            Lifetime realized returns
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-lg flex flex-col justify-between">
          <span className="text-[11px] text-slate-400 block uppercase font-sans">
            Execution Mode
          </span>
          <div className="flex items-center gap-1.5 text-xs font-bold">
            {hasValidBinanceKeys ? (
              <span className="text-[#00ff66] flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                BINANCE API READY
              </span>
            ) : (
              <span className="text-amber-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                SIMULATED PAPER VAULT
              </span>
            )}
          </div>
          <span className="text-[10px] text-slate-500">
            {hasValidBinanceKeys ? "Real order routing enabled" : "No Binance keys stored"}
          </span>
        </div>
      </div>

      {/* Main Tab View: Active Positions */}
      {subTab === "active" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 font-mono flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              Live Active Positions
            </h2>
            {activeTrades.length > 0 && (
              <button
                onClick={handleCloseAll}
                className="px-3 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/50 text-[#ff3344] text-xs font-bold transition flex items-center gap-1.5 font-mono"
              >
                <XCircle className="w-3.5 h-3.5" />
                Close All ({activeTrades.length})
              </button>
            )}
          </div>

          {activeTrades.length === 0 ? (
            <div className="p-12 rounded-2xl bg-slate-900/50 border border-slate-800 text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500">
                <Layers className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white">No Open Positions</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                When you execute a trade manually or Auto-Pilot detects high-confluence setups, active positions with live PnL and one-click exit will appear here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {activeTrades.map((trade) => {
                const isProfitable = trade.unrealizedPnl >= 0;
                const isTrulyReal = trade.mode === "REAL" && hasValidBinanceKeys;
                return (
                  <div
                    key={trade.id}
                    className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition-all shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 font-mono"
                  >
                    {/* Position details */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-black text-white">
                          {trade.symbol}
                        </span>
                        <span
                          className={`text-xs font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 ${
                            trade.direction === "LONG"
                              ? "bg-green-500/20 text-[#00ff66] border border-green-500/40"
                              : "bg-red-500/20 text-[#ff3344] border border-red-500/40"
                          }`}
                        >
                          {trade.direction === "LONG" ? (
                            <TrendingUp className="w-3.5 h-3.5" />
                          ) : (
                            <TrendingDown className="w-3.5 h-3.5" />
                          )}
                          {trade.direction} {trade.leverage > 1 ? `${trade.leverage}x` : ""}
                        </span>

                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                          {trade.marketType}
                        </span>

                        <span
                          className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                            isTrulyReal
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                              : "bg-amber-500/20 text-amber-400 border-amber-500/40"
                          }`}
                          title={isTrulyReal ? "Real Binance order execution" : "Paper/Simulated trade (No valid Binance API keys configured)"}
                        >
                          {isTrulyReal ? "REAL" : "PAPER / SIMULATED"}
                        </span>

                        <span className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-cyan-400" />
                          {trade.source}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
                        <div>
                          <span className="text-[10px] text-slate-500 block uppercase font-sans">
                            Entry Price
                          </span>
                          <span className="font-bold text-slate-200">
                            {formatPrice(trade.entryPrice)}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-500 block uppercase font-sans">
                            Current Price
                          </span>
                          <span className="font-bold text-white">
                            {formatPrice(trade.currentPrice)}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-500 block uppercase font-sans">
                            Stop Loss
                          </span>
                          <span className="font-bold text-[#ff3344]">
                            {formatPrice(trade.stopLossPrice)}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-500 block uppercase font-sans">
                            Take Profit
                          </span>
                          <span className="font-bold text-[#00ff66]">
                            {formatPrice(trade.takeProfitPrice)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Live PnL & Action */}
                    <div className="flex items-center justify-between md:justify-end gap-6 pt-3 md:pt-0 border-t md:border-t-0 border-slate-800">
                      <div className="text-left md:text-right">
                        <span className="text-[10px] text-slate-500 block uppercase font-sans">
                          Unrealized Live PnL
                        </span>
                        <div className="flex items-baseline md:justify-end gap-1.5">
                          <span
                            className={`text-xl font-black ${
                              isProfitable ? "text-[#00ff66]" : "text-[#ff3344]"
                            }`}
                          >
                            {isProfitable ? "+" : ""}${trade.unrealizedPnl.toFixed(2)}
                          </span>
                          <span
                            className={`text-xs font-bold flex items-center ${
                              isProfitable ? "text-[#00ff66]" : "text-[#ff3344]"
                            }`}
                          >
                            {isProfitable ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            {isProfitable ? "+" : ""}{trade.unrealizedPnlPercent.toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleCloseTrade(trade)}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-red-600/30 text-slate-300 hover:text-red-300 border border-slate-700 hover:border-red-500/50 font-bold text-xs uppercase tracking-wider transition flex items-center gap-1.5"
                      >
                        <XCircle className="w-4 h-4" />
                        <span>Close Trade</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Main Tab View: Trade History */}
      {subTab === "history" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 font-mono flex items-center gap-2">
              <History className="w-4 h-4 text-cyan-400" />
              Closed Trade Ledger
            </h2>
            <span className="text-xs text-slate-400 font-mono">
              Total Recorded: {tradeHistory.length}
            </span>
          </div>

          {tradeHistory.length === 0 ? (
            <div className="p-12 rounded-2xl bg-slate-900/50 border border-slate-800 text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500">
                <History className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-white">No Trade History Yet</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                Closed positions will automatically be archived here showing realized profit, loss, exit reason, and win rates.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800 font-sans">
                    <tr>
                      <th className="py-3 px-4">Market / Side</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Entry</th>
                      <th className="py-3 px-4">Exit</th>
                      <th className="py-3 px-4">Realized PnL</th>
                      <th className="py-3 px-4">Reason</th>
                      <th className="py-3 px-4">Closed At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {tradeHistory.map((t) => {
                      const isWin = t.realizedPnl >= 0;
                      const isTrulyReal = t.mode === "REAL" && hasValidBinanceKeys;
                      return (
                        <tr key={t.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white">{t.symbol}</span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  t.direction === "LONG"
                                    ? "bg-green-500/20 text-[#00ff66]"
                                    : "bg-red-500/20 text-[#ff3344]"
                                }`}
                              >
                                {t.direction} {t.leverage > 1 ? `${t.leverage}x` : ""}
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap text-slate-400">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">
                              {t.marketType} · {isTrulyReal ? "REAL" : "PAPER"}
                            </span>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap text-slate-300">
                            {formatPrice(t.entryPrice)}
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap text-white font-bold">
                            {formatPrice(t.exitPrice)}
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="flex items-baseline gap-1">
                              <span
                                className={`font-bold ${
                                  isWin ? "text-[#00ff66]" : "text-[#ff3344]"
                                }`}
                              >
                                {isWin ? "+" : ""}${t.realizedPnl.toFixed(2)}
                              </span>
                              <span
                                className={`text-[10px] ${
                                  isWin ? "text-[#00ff66]" : "text-[#ff3344]"
                                }`}
                              >
                                ({isWin ? "+" : ""}{t.realizedPnlPercent.toFixed(2)}%)
                              </span>
                            </div>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                t.exitReason === "TP"
                                  ? "bg-green-500/20 text-[#00ff66] border border-green-500/30"
                                  : t.exitReason === "SL"
                                  ? "bg-red-500/20 text-[#ff3344] border border-red-500/30"
                                  : "bg-slate-800 text-slate-300 border border-slate-700"
                              }`}
                            >
                              {t.exitReason}
                            </span>
                          </td>

                          <td className="py-3 px-4 whitespace-nowrap text-slate-500 text-[11px]">
                            {new Date(t.closeTime).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
