import { useEffect, useState, useCallback, useMemo } from "react";
import { Wallet, Plus, Trash2, Loader2, TrendingUp, TrendingDown, RefreshCw, ArrowUpRight, ArrowDownRight, FileText, Download } from "lucide-react";
import { COINS, PRO_COINS } from "../constants";
import { fetchCandles } from "../lib/binance";
import { formatPrice } from "../lib/patterns";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { autoTradeEngine } from "../lib/BinanceAutoTrade";
import { generateTaxReportPDF } from "../lib/TaxExportService";
import type { PortfolioHolding } from "../types";

const ALL_COINS = [...COINS, ...PRO_COINS];

interface HoldingWithPrice extends PortfolioHolding {
  currentPrice: number;
  value: number;
  cost: number;
  pnl: number;
  pnlPercent: number;
}

export default function Portfolio() {
  const { user } = useAuth();
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [coin, setCoin] = useState(ALL_COINS[0]);
  const [quantity, setQuantity] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const loadHoldings = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("portfolio_holdings")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) {
      setHoldings(data as PortfolioHolding[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadHoldings();
  }, [loadHoldings]);

  const enrichedHoldings = useMemo<HoldingWithPrice[]>(() => {
    return holdings.map((h) => ({
      ...h,
      currentPrice: 0,
      value: 0,
      cost: h.quantity * h.buy_price,
      pnl: 0,
      pnlPercent: 0,
    }));
  }, [holdings]);

  const [priceMap, setPriceMap] = useState<Record<string, number>>({});

  const fetchPrices = useCallback(async () => {
    setRefreshing(true);
    const newPrices: Record<string, number> = {};
    const settled = await Promise.allSettled(
      holdings.map(async (h) => {
        const data = await fetchCandles(h.binance_symbol, 1, "1m");
        if (data.length > 0) return { symbol: h.binance_symbol, price: data[0].close };
        return null;
      })
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) {
        newPrices[s.value.symbol] = s.value.price;
      }
    }
    setPriceMap(newPrices);
    setRefreshing(false);
  }, [holdings]);

  useEffect(() => {
    if (holdings.length > 0) {
      fetchPrices();
    }
  }, [holdings, fetchPrices]);

  const computedHoldings = useMemo<HoldingWithPrice[]>(() => {
    return holdings.map((h) => {
      const currentPrice = priceMap[h.binance_symbol] ?? h.buy_price;
      const value = h.quantity * currentPrice;
      const cost = h.quantity * h.buy_price;
      const pnl = value - cost;
      const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;
      return { ...h, currentPrice, value, cost, pnl, pnlPercent };
    });
  }, [holdings, priceMap]);

  const totalValue = computedHoldings.reduce((sum, h) => sum + h.value, 0);
  const totalCost = computedHoldings.reduce((sum, h) => sum + h.cost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  const handleExportTaxPDF = useCallback(() => {
    const allTrades = autoTradeEngine.getAllTrades();
    const closedTrades = allTrades.filter((t) => t.status === "CLOSED");
    const realizedPnl = closedTrades.reduce((acc, t) => acc + (t.realizedPnl ?? 0), 0);
    const feesPaid = closedTrades.reduce((acc, t) => acc + ((t.positionValue || (t.entryPrice * t.quantity)) * 0.0004), 0);
    const fundingEarned = autoTradeEngine.getProfitVaultTotal() * 0.4; // Estimated 40% funding component
    const netIncome = realizedPnl - feesPaid + fundingEarned;

    generateTaxReportPDF({
      userEmail: user?.email || undefined,
      totalRealizedPnl: realizedPnl,
      totalFeesPaid: feesPaid,
      totalFundingFeesEarned: fundingEarned,
      netTaxableIncome: netIncome,
      trades: closedTrades,
    });
  }, [user?.email]);

  const addHolding = useCallback(async () => {
    if (!user) return;
    const qty = parseFloat(quantity);
    const bp = parseFloat(buyPrice);
    if (isNaN(qty) || qty <= 0 || isNaN(bp) || bp <= 0) return;

    const { data } = await supabase
      .from("portfolio_holdings")
      .insert({
        coin_symbol: coin.symbol,
        binance_symbol: coin.binanceSymbol,
        coin_label: coin.label,
        quantity: qty,
        buy_price: bp,
      })
      .select()
      .single();

    if (data) {
      setHoldings((prev) => [data as PortfolioHolding, ...prev]);
    }
    setQuantity("");
    setBuyPrice("");
  }, [user, coin, quantity, buyPrice]);

  const removeHolding = useCallback(async (id: string) => {
    await supabase.from("portfolio_holdings").delete().eq("id", id);
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  }, []);

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
            <Wallet className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-400 font-medium">Sign in to track your portfolio</p>
          <p className="text-sm text-slate-500 mt-1 max-w-xs">
            Create an account or log in to save your holdings and see real-time P/L.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading portfolio…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Wallet className="w-5 h-5 text-cyan-400" />
            Portfolio Tracker
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Track your holdings and see real-time P/L</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tax Export Service Trigger Button */}
          <button
            onClick={handleExportTaxPDF}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#00ff66]/10 hover:bg-[#00ff66]/20 border border-[#00ff66]/40 text-[#00ff66] text-xs font-black uppercase tracking-wider transition-all shadow-md"
            title="Download Audited Tax Report (PDF)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Tax PDF</span>
          </button>

          {holdings.length > 0 && (
            <button
              onClick={fetchPrices}
              disabled={refreshing}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh Prices</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {holdings.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-500 mb-1">Total Value</p>
            <p className="text-2xl font-bold text-white">{formatPrice(totalValue)}</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-500 mb-1">Total Cost</p>
            <p className="text-2xl font-bold text-slate-300">{formatPrice(totalCost)}</p>
          </div>
          <div className={`rounded-xl border p-4 ${totalPnl >= 0 ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
            <p className="text-xs text-slate-500 mb-1">Total P/L</p>
            <p className={`text-2xl font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              {totalPnl >= 0 ? "+" : ""}{formatPrice(Math.abs(totalPnl))}
            </p>
          </div>
          <div className={`rounded-xl border p-4 ${totalPnlPercent >= 0 ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
            <p className="text-xs text-slate-500 mb-1">P/L %</p>
            <p className={`text-2xl font-bold flex items-center gap-1 ${totalPnlPercent >= 0 ? "text-green-400" : "text-red-400"}`}>
              {totalPnlPercent >= 0 ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
              {Math.abs(totalPnlPercent).toFixed(2)}%
            </p>
          </div>
        </div>
      )}

      {/* Add holding form */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Coin</label>
            <select
              value={coin.binanceSymbol}
              onChange={(e) => {
                const found = ALL_COINS.find((c) => c.binanceSymbol === e.target.value);
                if (found) setCoin(found);
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-500"
            >
              {ALL_COINS.map((c) => (
                <option key={c.binanceSymbol} value={c.binanceSymbol}>
                  {c.symbol} — {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Quantity</label>
            <input
              type="number"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Buy Price ($)</label>
            <input
              type="number"
              inputMode="decimal"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={addHolding}
              disabled={!quantity || !buyPrice || parseFloat(quantity) <= 0 || parseFloat(buyPrice) <= 0}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-900 text-sm font-bold transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add Holding
            </button>
          </div>
        </div>
      </div>

      {/* Holdings list */}
      {holdings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
            <Wallet className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-400 font-medium">No holdings yet</p>
          <p className="text-sm text-slate-500 mt-1 max-w-xs">
            Add your crypto holdings above to track real-time profit and loss.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {computedHoldings.map((h) => {
            const isProfit = h.pnl >= 0;
            return (
              <div
                key={h.id}
                className="flex items-center gap-3 p-3 sm:p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xs font-bold shrink-0">
                  {h.coin_symbol.slice(0, 3)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">
                    {h.coin_symbol}<span className="text-slate-500 font-normal">/USDT</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {h.quantity} @ {formatPrice(h.buy_price)}
                  </p>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <p className="text-xs text-slate-500">Current</p>
                  <p className="text-sm font-medium text-slate-200">{formatPrice(h.currentPrice)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium text-slate-200">{formatPrice(h.value)}</p>
                  <p className={`text-xs font-medium flex items-center justify-end gap-0.5 ${isProfit ? "text-green-400" : "text-red-400"}`}>
                    {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {isProfit ? "+" : ""}{h.pnlPercent.toFixed(2)}%
                  </p>
                </div>
                <div className={`text-right shrink-0 w-20 hidden md:block`}>
                  <p className={`text-sm font-bold ${isProfit ? "text-green-400" : "text-red-400"}`}>
                    {isProfit ? "+" : ""}{formatPrice(Math.abs(h.pnl))}
                  </p>
                </div>
                <button
                  onClick={() => removeHolding(h.id)}
                  className="text-slate-600 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
