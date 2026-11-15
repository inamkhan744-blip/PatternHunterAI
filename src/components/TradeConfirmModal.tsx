import { useState } from "react";
import { calculatePositionSize } from "../lib/BinanceAutoTrade";
import { useWalletBalance } from "../lib/WalletBalanceContext";
import type { SignalCard } from "./SignalCardsGrid";
import type { ScannerExecutionSettings } from "./ScannerTradeSettings";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (orderType: "MARKET" | "LIMIT" | "STOP_MARKET") =>
    | void
    | Promise<{ success: boolean; error?: string } | void>;
  cardData: SignalCard;
  settings: ScannerExecutionSettings;
  onOpenScannerSettings?: () => void;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "—";
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export default function TradeConfirmModal({ isOpen, onClose, onConfirm, cardData, settings, onOpenScannerSettings }: Props) {
  const { balance: availableBalance } = useWalletBalance();
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP_MARKET">("MARKET");
  if (!isOpen) return null;

  const isLong = cardData.direction !== "SHORT";
  const entry = cardData.entryPrice;
  const sl = cardData.stopLoss;
  const tp = cardData.takeProfit;
  const currentPrice = cardData.price;

  let quantity = 0;
  let positionValue = 0;
  if (settings.sizingMode === "Fixed USD") {
    positionValue = settings.fixedUsdAmount;
    quantity = entry > 0 ? settings.fixedUsdAmount / entry : 0;
  } else {
    const sizing = calculatePositionSize(
      settings.riskPercent,
      Math.max(0, availableBalance),
      settings.leverage,
      entry,
      sl
    );
    quantity = sizing.quantity;
    positionValue = sizing.positionValue;
  }

  const maxLoss = Math.abs(entry - sl) * quantity;
  const potentialProfit = Math.abs(tp - entry) * quantity;

  const handleConfirm = async () => {
    setExecutionError(null);
    try {
      const result = await onConfirm(orderType);
      if (result && typeof result === "object" && "success" in result && !result.success) {
        setExecutionError(result.error || "Trade execution failed.");
        return;
      }
      onClose();
    } catch (err) {
      setExecutionError(err instanceof Error ? err.message : "Trade execution failed.");
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900/90 shadow-2xl shadow-blue-500/20 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Confirm Trade Execution</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none">
            ×
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">Order Type</span>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as "MARKET" | "LIMIT" | "STOP_MARKET")}
            className="rounded-lg bg-slate-800 border border-slate-700 px-2 py-1 text-slate-200"
          >
            <option value="MARKET">Market</option>
            <option value="LIMIT">Limit</option>
            <option value="STOP_MARKET">Stop-Market</option>
          </select>
        </div>

        <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Available Balance</span>
            <span className="font-mono font-bold text-cyan-300">${Math.max(0, availableBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-slate-400">Risk {settings.riskPercent}%</span>
            <span className="font-mono font-bold text-amber-300">
              ${(Math.max(0, availableBalance) * (settings.riskPercent / 100)).toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-slate-400">Position Size</span>
            <span className="font-mono font-bold text-slate-200">${positionValue.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-slate-400">Margin Required</span>
            <span className="font-mono font-bold text-slate-200">
              ${(positionValue / Math.max(1, settings.leverage)).toFixed(2)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-black text-white">{cardData.coin.symbol}/USDT</p>
            <p className="text-[11px] text-slate-400">Current Price: {formatPrice(currentPrice)}</p>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
              isLong
                ? "bg-green-500/20 text-green-400 border-green-500/40"
                : "bg-red-500/20 text-red-400 border-red-500/40"
            }`}
          >
            {isLong ? "LONG" : "SHORT"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3">
            <p className="text-slate-500 uppercase tracking-wider text-[10px]">Entry Price</p>
            <p className="text-sm font-bold text-slate-200 mt-1">{formatPrice(entry)}</p>
          </div>
          <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3">
            <p className="text-slate-500 uppercase tracking-wider text-[10px]">Position Size</p>
            <p className="text-sm font-bold text-slate-200 mt-1">
              ${positionValue.toFixed(2)} · {quantity.toFixed(4)} {cardData.coin.symbol}
            </p>
          </div>
          <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
            <p className="text-slate-500 uppercase tracking-wider text-[10px]">Stop Loss</p>
            <p className="text-sm font-bold text-red-400 mt-1">{formatPrice(sl)}</p>
          </div>
          <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3">
            <p className="text-slate-500 uppercase tracking-wider text-[10px]">Take Profit</p>
            <p className="text-sm font-bold text-green-400 mt-1">{formatPrice(tp)}</p>
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-3 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Max Loss</span>
            <span className="text-red-400 font-bold">-${maxLoss.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Potential Profit</span>
            <span className="text-green-400 font-bold">+${potentialProfit.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Leverage</span>
            <span className="text-slate-200 font-bold">{settings.leverage}x</span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
          >
            Cancel
          </button>
          {executionError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 space-y-2">
              <div>{executionError}</div>
              {executionError.includes("Scanner Limit Reached") && onOpenScannerSettings && (
                <button
                  onClick={onOpenScannerSettings}
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  Open Scanner Trade Settings
                </button>
              )}
            </div>
          )}

          <button
            onClick={() => void handleConfirm()}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 text-xs font-bold text-white shadow-lg shadow-blue-500/40 transition"
          >
            Execute Trade
          </button>
        </div>
      </div>
    </div>
  );
}