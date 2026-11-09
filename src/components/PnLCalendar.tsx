import { useState, useMemo } from "react";
import {
  Calendar as CalendarIcon,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  CheckCircle2,
  XCircle,
  BarChart2,
} from "lucide-react";
import { formatPrice } from "../lib/patterns";
import { autoTradeEngine, ManagedTrade } from "../lib/BinanceAutoTrade";
import { paperTradingEngine } from "../lib/PaperTrading";

interface DayData {
  date: string;
  dayOfMonth: number;
  dayOfWeek: number;
  tradesCount: number;
  winCount: number;
  lossCount: number;
  pnl: number;
  trades: {
    symbol: string;
    pnl: number;
    direction: string;
    exitReason?: string;
  }[];
}

export default function PnLCalendar() {
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);
  const [dataSource, setDataSource] = useState<"LIVE" | "PAPER">("LIVE");

  // Load trades from engine or paper engine
  const closedTrades = useMemo(() => {
    if (dataSource === "LIVE") {
      return autoTradeEngine.getAllTrades().filter((t) => t.status === "CLOSED");
    } else {
      return paperTradingEngine.getClosedTrades();
    }
  }, [dataSource]);

  // Aggregate past 30 days
  const { days, totalPnl, winRate, totalDaysTraded, bestDay, worstDay } = useMemo(() => {
    const dayMap = new Map<string, DayData>();
    const now = new Date();

    // Initialize 30 days
    const dayList: DayData[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().slice(0, 10);
      const dayData: DayData = {
        date: dateKey,
        dayOfMonth: d.getDate(),
        dayOfWeek: d.getDay(),
        tradesCount: 0,
        winCount: 0,
        lossCount: 0,
        pnl: 0,
        trades: [],
      };
      dayMap.set(dateKey, dayData);
      dayList.push(dayData);
    }

    // Populate with closed trade PnL
    for (const trade of closedTrades) {
      const tradeTime = trade.openTime || Date.now();
      const dateKey = new Date(tradeTime).toISOString().slice(0, 10);
      const day = dayMap.get(dateKey);
      if (day) {
        const pnl = trade.realizedPnl ?? 0;
        day.tradesCount += 1;
        day.pnl = Number((day.pnl + pnl).toFixed(2));
        if (pnl >= 0) day.winCount += 1;
        else day.lossCount += 1;
        day.trades.push({
          symbol: trade.symbol,
          pnl,
          direction: trade.direction,
          exitReason: (trade as ManagedTrade).closePrice ? "EXIT" : undefined,
        });
      }
    }

    let sumPnl = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let activeDays = 0;
    let maxDay = -Infinity;
    let minDay = Infinity;

    for (const day of dayList) {
      sumPnl += day.pnl;
      totalWins += day.winCount;
      totalLosses += day.lossCount;
      if (day.tradesCount > 0) {
        activeDays++;
        if (day.pnl > maxDay) maxDay = day.pnl;
        if (day.pnl < minDay) minDay = day.pnl;
      }
    }

    const calculatedWinRate = totalWins + totalLosses > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;

    return {
      days: dayList,
      totalPnl: Number(sumPnl.toFixed(2)),
      winRate: Number(calculatedWinRate.toFixed(1)),
      totalDaysTraded: activeDays,
      bestDay: maxDay === -Infinity ? 0 : maxDay,
      worstDay: minDay === Infinity ? 0 : minDay,
    };
  }, [closedTrades]);

  // Color generator for GitHub style calendar
  const getCellBg = (pnl: number, count: number) => {
    if (count === 0 || pnl === 0) return "bg-slate-900/60 border-slate-800 text-slate-500 hover:border-slate-600";
    if (pnl > 0) {
      if (pnl > 500) return "bg-emerald-500/80 border-emerald-400 text-slate-950 font-black shadow-md shadow-emerald-500/20";
      if (pnl > 150) return "bg-emerald-500/50 border-emerald-500/70 text-white font-bold";
      return "bg-emerald-500/25 border-emerald-500/40 text-emerald-300";
    } else {
      if (pnl < -500) return "bg-rose-600/80 border-rose-500 text-white font-black shadow-md shadow-rose-600/20";
      if (pnl < -150) return "bg-rose-500/50 border-rose-500/70 text-white font-bold";
      return "bg-rose-500/25 border-rose-500/40 text-rose-300";
    }
  };

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 font-mono space-y-6">
      {/* Header and Source Toggle */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-cyan-400" />
              P&L Performance Heatmap (30 Days)
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              Institutional Terminal View
            </span>
          </div>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            GitHub-style trading journal heatmap analyzing daily realized alpha and drawdown
          </p>
        </div>

        <div className="flex items-center gap-2 bg-[#090d16] p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setDataSource("LIVE")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              dataSource === "LIVE"
                ? "bg-cyan-500 text-slate-950 shadow-md"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Live Engine Trades
          </button>
          <button
            onClick={() => setDataSource("PAPER")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              dataSource === "PAPER"
                ? "bg-amber-500 text-slate-950 shadow-md"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Paper Simulation
          </button>
        </div>
      </div>

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-[#090d16] border border-slate-800">
          <span className="text-[10px] text-slate-500 block uppercase font-sans">30D Realized P&L</span>
          <p
            className={`text-xl font-bold font-mono mt-1 ${
              totalPnl >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"
            }`}
          >
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-[#090d16] border border-slate-800">
          <span className="text-[10px] text-slate-500 block uppercase font-sans">30D Win Rate</span>
          <p className="text-xl font-bold font-mono text-cyan-400 mt-1">
            {winRate}%
          </p>
        </div>

        <div className="p-4 rounded-xl bg-[#090d16] border border-slate-800">
          <span className="text-[10px] text-slate-500 block uppercase font-sans">Best Day</span>
          <p className="text-xl font-bold font-mono text-[#00ff66] mt-1">
            +${bestDay.toFixed(2)}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-[#090d16] border border-slate-800">
          <span className="text-[10px] text-slate-500 block uppercase font-sans">Worst Day</span>
          <p className="text-xl font-bold font-mono text-[#ff3344] mt-1">
            ${worstDay.toFixed(2)}
          </p>
        </div>
      </div>

      {/* 30-Day GitHub Style Grid */}
      <div className="p-5 rounded-2xl bg-[#090d16] border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-cyan-400" />
            30-Day Heatmap Grid
          </span>

          <div className="flex items-center gap-2 text-[10px] text-slate-400">
            <span>Loss</span>
            <div className="w-3 h-3 rounded bg-rose-500/80" />
            <div className="w-3 h-3 rounded bg-rose-500/30" />
            <div className="w-3 h-3 rounded bg-slate-800" />
            <div className="w-3 h-3 rounded bg-emerald-500/30" />
            <div className="w-3 h-3 rounded bg-emerald-500/80" />
            <span>Profit</span>
          </div>
        </div>

        <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-10 gap-2">
          {days.map((day) => {
            const isSelected = selectedDay?.date === day.date;
            return (
              <button
                key={day.date}
                onClick={() => setSelectedDay(day)}
                className={`h-16 p-2 rounded-xl border flex flex-col justify-between transition-all text-left relative overflow-hidden ${getCellBg(
                  day.pnl,
                  day.tradesCount
                )} ${isSelected ? "ring-2 ring-cyan-400 scale-105" : ""}`}
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="opacity-70">{day.date.slice(5)}</span>
                  {day.tradesCount > 0 && (
                    <span className="text-[9px] opacity-80">{day.tradesCount}t</span>
                  )}
                </div>

                <div className="text-xs font-mono font-bold truncate">
                  {day.tradesCount > 0 ? (
                    `${day.pnl >= 0 ? "+" : ""}$${day.pnl.toFixed(0)}`
                  ) : (
                    <span className="text-slate-600 font-normal">—</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Day Inspector */}
      {selectedDay && (
        <div className="p-5 rounded-2xl bg-[#090d16] border border-cyan-500/30 animate-in fade-in duration-200 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-cyan-400" />
              Day Inspection: {selectedDay.date}
            </h3>
            <span
              className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                selectedDay.pnl >= 0
                  ? "bg-green-500/20 text-[#00ff66]"
                  : "bg-red-500/20 text-[#ff3344]"
              }`}
            >
              Day Net P&L: {selectedDay.pnl >= 0 ? "+" : ""}${selectedDay.pnl.toFixed(2)}
            </span>
          </div>

          {selectedDay.trades.length === 0 ? (
            <p className="text-xs text-slate-500 font-sans py-2">
              No closed executions registered for this date.
            </p>
          ) : (
            <div className="space-y-1.5 pt-1">
              {selectedDay.trades.map((t, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        t.direction === "LONG"
                          ? "bg-green-500/20 text-[#00ff66]"
                          : "bg-red-500/20 text-[#ff3344]"
                      }`}
                    >
                      {t.direction}
                    </span>
                    <span className="font-semibold text-white">{t.symbol}</span>
                  </div>

                  <span
                    className={`font-mono font-bold ${
                      t.pnl >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"
                    }`}
                  >
                    {t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
