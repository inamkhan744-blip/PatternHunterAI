import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Zap, RefreshCw, TrendingUp, TrendingDown, Flame, Droplet } from "lucide-react";
import { COINS, PRO_COINS } from "../constants";
import { fetchCandles } from "../lib/binance";
import { evaluateConfluence } from "../lib/ConfluenceEngine";
import { scanSMC } from "../lib/SMCScanner";
import { rsi, atr, bollingerBands } from "../lib/indicators";
import { calculateAtrStopLoss } from "../lib/BinanceAutoTrade";
import { formatPrice } from "../lib/patterns";
import type { Coin, Timeframe } from "../types";

interface SignalCard {
  coin: Coin;
  price: number;
  change: number;
  score: number;
  direction: "LONG" | "SHORT";
  stopLoss: number;
  takeProfit: number;
  pump: boolean;
  dump: boolean;
  alertReason: string;
}

interface Props {
  timeframe: Timeframe;
  onSelectCoin: (coin: Coin) => void;
  onTradeNow: (coin: Coin, price: number, atr: number) => void;
  isPro?: boolean;
}

function detectPump(candles: { close: number; volume: number }[]) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const bb = bollingerBands(closes, 20, 2);
  const rsiSeries = rsi(closes, 14);

  const last = candles.length - 1;
  const bandwidth = bb.upper[last] && bb.lower[last] && bb.middle[last]
    ? (bb.upper[last]! - bb.lower[last]!) / bb.middle[last]!
    : 1;
  const squeeze = bandwidth < 0.045;

  const recentVolumes = volumes.slice(-21, -1);
  const avgVolume =
    recentVolumes.reduce((sum, value) => sum + value, 0) / Math.max(1, recentVolumes.length);
  const volumeSpike = volumes[last] > Math.max(1, avgVolume) * 3;

  const rsiNow = rsiSeries[last];
  const rsiPrev = rsiSeries[Math.max(0, last - 5)];
  const priceNow = closes[last];
  const pricePrev = closes[Math.max(0, last - 5)];
  const bullishDivergence = priceNow < pricePrev && rsiNow !== null && rsiPrev !== null && rsiNow > rsiPrev;
  const bearishDivergence = priceNow > pricePrev && rsiNow !== null && rsiPrev !== null && rsiNow < rsiPrev;

  const pump = squeeze && volumeSpike && bullishDivergence;
  const dump = squeeze && volumeSpike && bearishDivergence;

  let alertReason = "";
  if (pump) alertReason = "Bollinger squeeze, volume spike, and bullish RSI divergence";
  else if (dump) alertReason = "Bollinger squeeze, volume spike, and bearish RSI divergence";

  return { pump, dump, alertReason };
}

export default function SignalCardsGrid({ timeframe, onSelectCoin, onTradeNow, isPro = false }: Props) {
  const [cards, setCards] = useState<SignalCard[]>([]);
  const [loading, setLoading] = useState(true);

  const coins = useMemo(() => {
    const all = [
      ...COINS.map((coin) => ({ coin, isPro: false })),
      ...PRO_COINS.map((coin) => ({ coin, isPro: true })),
    ];
    const accessible = isPro ? all : all.filter((item) => !item.isPro);
    return accessible.slice(0, 6);
  }, [isPro]);

  const scan = useCallback(async () => {
    setLoading(cards.length === 0);
    const settled = await Promise.allSettled(
      coins.map(async ({ coin }) => {
        const data = await fetchCandles(coin.binanceSymbol, 100, timeframe);
        if (data.length < 30) return null;

        const smcData = scanSMC(data);
        const confluence = evaluateConfluence(data, smcData, null);
        const price = data[data.length - 1].close;
        const first = data[Math.max(0, data.length - 25)].close;
        const change = first > 0 ? ((price - first) / first) * 100 : 0;
        const atrSeries = atr(data, 14);
        const atrValue = atrSeries[atrSeries.length - 1] || price * 0.02;
        const { pump, dump, alertReason } = detectPump(data);

        const direction: "LONG" | "SHORT" =
          pump ? "LONG" : dump ? "SHORT" : confluence.setupBias.includes("Buy") ? "LONG" : "SHORT";

        const levels = calculateAtrStopLoss(price, atrValue, direction, 1.5, 2.0);

        return {
          coin,
          price,
          change,
          score: confluence.score,
          direction,
          stopLoss: levels.stopLossPrice,
          takeProfit: levels.takeProfitPrice,
          pump,
          dump,
          alertReason,
        } as SignalCard;
      })
    );

    const next = settled
      .map((result) => (result.status === "fulfilled" ? result.value : null))
      .filter((value): value is SignalCard => value !== null)
      .sort((a, b) => b.score - a.score);

    setCards(next);
    setLoading(false);
  }, [coins, timeframe]);

  useEffect(() => {
    void scan();
    const timer = setInterval(() => void scan(), 5000);
    return () => clearInterval(timer);
  }, [scan]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">Signal Cards</h2>
          <p className="text-xs text-slate-500">Auto-refreshing every 5 seconds</p>
        </div>
        <button
          onClick={() => void scan()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {loading && cards.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Scanning markets...
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {cards.map((card) => (
            <div
              key={card.coin.binanceSymbol}
              className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3 shadow-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <button
                    onClick={() => onSelectCoin(card.coin)}
                    className="text-sm font-bold text-white hover:text-cyan-300 transition"
                  >
                    {card.coin.symbol}/USDT
                  </button>
                  <div className="text-xs text-slate-400 font-mono">{formatPrice(card.price)}</div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                    card.direction === "LONG"
                      ? "bg-green-500/20 text-green-400 border border-green-500/40"
                      : "bg-red-500/20 text-red-400 border border-red-500/40"
                  }`}
                >
                  {card.direction}
                </span>
              </div>

              {(card.pump || card.dump) && (
                <div
                  className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    card.pump
                      ? "bg-orange-500/20 text-orange-300 border border-orange-500/40"
                      : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  }`}
                  title={card.alertReason}
                >
                  {card.pump ? <Flame className="w-3 h-3" /> : <Droplet className="w-3 h-3" />}
                  {card.pump ? "Pump Alert" : "Dump Alert"}
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2">
                  <div className="text-slate-500">Stop Loss</div>
                  <div className="font-mono font-bold text-red-400">{formatPrice(card.stopLoss)}</div>
                </div>
                <div className="rounded-lg bg-slate-950/70 border border-slate-800 p-2">
                  <div className="text-slate-500">Take Profit</div>
                  <div className="font-mono font-bold text-green-400">{formatPrice(card.takeProfit)}</div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Score {card.score}/100</span>
                  <span className={card.change >= 0 ? "text-green-400" : "text-red-400"}>
                    {card.change >= 0 ? <TrendingUp className="w-3 h-3 inline" /> : <TrendingDown className="w-3 h-3 inline" />}
                    {Math.abs(card.change).toFixed(2)}%
                  </span>
                </div>
                <button
                  onClick={() => onTradeNow(card.coin, card.price, card.stopLoss > 0 ? Math.abs(card.price - card.stopLoss) / 1.5 : card.price * 0.02)}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-black transition"
                >
                  Trade Now
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
