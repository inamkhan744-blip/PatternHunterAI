import { useState, useEffect, useMemo } from "react";
import { Play, Square, Bot, Activity, AlertCircle, Layers, CheckCircle2 } from "lucide-react";
import { gridTradingBot, GridBotState, GridBotConfig } from "../lib/GridBot";
import { formatPrice } from "../lib/patterns";
import type { Coin } from "../types";

interface Props {
  selectedCoin: Coin;
  currentPrice: number;
}

export default function GridBotUI({ selectedCoin, currentPrice }: Props) {
  const [botState, setBotState] = useState<GridBotState>(gridTradingBot.getState());

  // Input states with intelligent defaults around current price (e.g. ±5%)
  const defaultLower = useMemo(() => {
    return currentPrice > 0 ? Number((currentPrice * 0.95).toFixed(currentPrice > 1 ? 2 : 5)) : 50000;
  }, [currentPrice]);

  const defaultUpper = useMemo(() => {
    return currentPrice > 0 ? Number((currentPrice * 1.05).toFixed(currentPrice > 1 ? 2 : 5)) : 70000;
  }, [currentPrice]);

  const [lowerPrice, setLowerPrice] = useState<number>(defaultLower);
  const [upperPrice, setUpperPrice] = useState<number>(defaultUpper);
  const [gridCount, setGridCount] = useState<number>(10);
  const [investmentAmount, setInvestmentAmount] = useState<number>(1000);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Subscribe to bot engine changes
  useEffect(() => {
    const unsub = gridTradingBot.subscribe((next) => {
      setBotState(next);
    });
    return unsub;
  }, []);

  // Update inputs if coin changes and bot is not active
  useEffect(() => {
    if (!botState.isActive && currentPrice > 0) {
      setLowerPrice(Number((currentPrice * 0.95).toFixed(currentPrice > 1 ? 2 : 5)));
      setUpperPrice(Number((currentPrice * 1.05).toFixed(currentPrice > 1 ? 2 : 5)));
    }
  }, [selectedCoin.symbol, botState.isActive, currentPrice]);

  // Derived calculations
  const previewGrids = useMemo(() => {
    if (botState.isActive && botState.grids.length > 0) {
      return botState.grids;
    }
    return gridTradingBot.calculateGridLevels(lowerPrice, upperPrice, gridCount);
  }, [botState.isActive, botState.grids, lowerPrice, upperPrice, gridCount]);

  const profitPerGridPct = useMemo(() => {
    if (previewGrids.length < 2 || lowerPrice <= 0) return 0;
    const step = (upperPrice - lowerPrice) / (gridCount - 1);
    return Number(((step / lowerPrice) * 100).toFixed(2));
  }, [previewGrids, lowerPrice, upperPrice, gridCount]);

  const handleStartBot = () => {
    setErrorMsg(null);
    const config: GridBotConfig = {
      symbol: selectedCoin.binanceSymbol,
      lowerPrice,
      upperPrice,
      gridCount,
      investmentAmount,
    };

    const res = gridTradingBot.startBot(config, currentPrice);
    if (!res.success) {
      setErrorMsg(res.error || "Failed to start grid bot.");
    }
  };

  const handleStopBot = () => {
    gridTradingBot.stopBot();
  };

  return (
    <div className="rounded-2xl bg-[#090d16] border border-cyan-500/30 p-5 font-mono shadow-2xl space-y-5">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black text-white uppercase tracking-wider">
                GRID TRADING BOT // SIDEWAYS OSCILLATION
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 uppercase">
                PAPER MODE
              </span>
            </div>
            <p className="text-xs text-slate-400 font-sans mt-0.5">
              Simulated automated grid arbitrage. Places laddered buy/sell limit orders to capture range volatility.
            </p>
          </div>
        </div>

        {/* Live Status indicator */}
        <div className="flex items-center gap-2">
          {botState.isActive ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/50 text-[#00ff66] text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-[#00ff66] animate-ping" />
              <span>BOT RUNNING: {botState.config?.symbol}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-slate-600" />
              <span>BOT IDLE</span>
            </div>
          )}
        </div>
      </div>

      {/* Error alert if any */}
      {errorMsg && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/50 border border-red-500/40 text-red-300 text-xs font-sans">
          <AlertCircle className="w-4 h-4 shrink-0 text-[#ff3344]" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Grid Configuration Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Lower Price */}
        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
          <label className="text-[11px] text-slate-400 block mb-1">LOWER PRICE (USDT)</label>
          <input
            type="number"
            step="any"
            disabled={botState.isActive}
            value={lowerPrice}
            onChange={(e) => setLowerPrice(parseFloat(e.target.value) || 0)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-[#00ff66] font-bold outline-none focus:border-cyan-500 disabled:opacity-50"
          />
          <span className="text-[10px] text-slate-500 mt-1 block">Support floor for buy ladder</span>
        </div>

        {/* Upper Price */}
        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
          <label className="text-[11px] text-slate-400 block mb-1">UPPER PRICE (USDT)</label>
          <input
            type="number"
            step="any"
            disabled={botState.isActive}
            value={upperPrice}
            onChange={(e) => setUpperPrice(parseFloat(e.target.value) || 0)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-[#ff3344] font-bold outline-none focus:border-cyan-500 disabled:opacity-50"
          />
          <span className="text-[10px] text-slate-500 mt-1 block">Resistance roof for sell ladder</span>
        </div>

        {/* Number of Grids */}
        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
          <label className="text-[11px] text-slate-400 block mb-1">NUMBER OF GRIDS</label>
          <input
            type="number"
            min="3"
            max="50"
            disabled={botState.isActive}
            value={gridCount}
            onChange={(e) => setGridCount(parseInt(e.target.value, 10) || 5)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-cyan-400 font-bold outline-none focus:border-cyan-500 disabled:opacity-50"
          />
          <span className="text-[10px] text-slate-500 mt-1 block">
            Grid spacing: ~{profitPerGridPct}% profit / grid
          </span>
        </div>

        {/* Investment Amount */}
        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
          <label className="text-[11px] text-slate-400 block mb-1">SIMULATED INVESTMENT</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
            <input
              type="number"
              step="50"
              disabled={botState.isActive}
              value={investmentAmount}
              onChange={(e) => setInvestmentAmount(parseFloat(e.target.value) || 100)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-sm text-amber-400 font-bold outline-none focus:border-cyan-500 disabled:opacity-50"
            />
          </div>
          <span className="text-[10px] text-slate-500 mt-1 block">Virtual allocation (Paper mode)</span>
        </div>
      </div>

      {/* Action Button & Metric Dashboard */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-slate-950 border border-slate-800">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full sm:w-auto">
          <div>
            <span className="text-[10px] text-slate-500 block uppercase">MARKET PRICE</span>
            <span className="text-sm font-bold text-white">${formatPrice(currentPrice)}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase">TOTAL REALIZED PNL</span>
            <span className={`text-sm font-bold ${botState.totalRealizedPnl >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
              {botState.totalRealizedPnl >= 0 ? "+" : ""}${botState.totalRealizedPnl.toFixed(2)}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase">ARBITRAGE CYCLES</span>
            <span className="text-sm font-bold text-cyan-400">{botState.totalArbitrageCycles}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 block uppercase">ACTIVE ORDERS</span>
            <span className="text-sm font-bold text-amber-400">{botState.activeOrders.length}</span>
          </div>
        </div>

        {/* Start / Stop Toggle */}
        <div className="w-full sm:w-auto flex items-center justify-end">
          {botState.isActive ? (
            <button
              onClick={handleStopBot}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-red-950/40"
            >
              <Square className="w-4 h-4 fill-white" />
              <span>STOP GRID BOT</span>
            </button>
          ) : (
            <button
              onClick={handleStartBot}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-md shadow-cyan-950/40"
            >
              <Play className="w-4 h-4 fill-slate-950" />
              <span>START GRID BOT (PAPER)</span>
            </button>
          )}
        </div>
      </div>

      {/* Visual Representation of Grid Levels */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-300">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            GRID DEPTH MATRIX ({previewGrids.length} LEVELS)
          </span>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-500/40 border border-red-500" />
              <span>Sell Grid (Resistance)</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-green-500/40 border border-green-500" />
              <span>Buy Grid (Support)</span>
            </span>
          </div>
        </div>

        <div className="max-h-60 overflow-y-auto space-y-1.5 p-3 rounded-xl bg-slate-950/90 border border-slate-800">
          {previewGrids.slice().reverse().map((level, idx) => {
            const isAbove = level > currentPrice;
            const isClosest = Math.abs(level - currentPrice) === Math.min(...previewGrids.map((g) => Math.abs(g - currentPrice)));
            const activeOrder = botState.activeOrders.find((o) => Math.abs(o.price - level) < 0.001);

            return (
              <div
                key={level}
                className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-all ${
                  isAbove
                    ? "bg-red-950/20 border border-red-500/20 text-red-300"
                    : "bg-green-950/20 border border-green-500/20 text-green-300"
                } ${isClosest ? "ring-1 ring-cyan-400" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 w-8">
                    #{previewGrids.length - 1 - idx}
                  </span>
                  <span className="font-bold">
                    ${formatPrice(level)}
                  </span>
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800">
                    {isAbove ? "SELL LIMIT" : "BUY LIMIT"}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {activeOrder && (
                    <span className="text-[10px] text-cyan-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      ORDER ACTIVE ({activeOrder.quantity} units)
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500">
                    {((level / currentPrice - 1) * 100).toFixed(2)}% vs Price
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Execution Log */}
      {botState.filledOrders.length > 0 && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            RECENT EXECUTED GRID CYCLES ({botState.filledOrders.length})
          </span>
          <div className="max-h-36 overflow-y-auto space-y-1">
            {botState.filledOrders.slice(0, 10).map((fill) => (
              <div
                key={fill.id}
                className="flex items-center justify-between px-3 py-1.5 rounded bg-slate-900/60 border border-slate-800 text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${fill.side === "BUY" ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
                    {fill.side}
                  </span>
                  <span className="text-slate-300">${formatPrice(fill.price)}</span>
                  <span className="text-slate-500">Qty: {fill.quantity}</span>
                </div>
                <div className="flex items-center gap-2">
                  {fill.realizedPnl !== undefined && fill.realizedPnl > 0 && (
                    <span className="text-[#00ff66] font-bold">
                      +${fill.realizedPnl.toFixed(2)} profit
                    </span>
                  )}
                  <span className="text-slate-500 text-[10px]">
                    {fill.filledAt ? new Date(fill.filledAt).toLocaleTimeString() : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
