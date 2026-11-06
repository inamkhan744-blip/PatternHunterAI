import { useCallback, useEffect, useState } from "react";
import { History, Loader2, TrendingUp, TrendingDown, Trash2, Download } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatPrice } from "../lib/patterns";
import type { SignalHistory } from "../types";

interface Props {
  refreshKey: number;
  onOutcomeChange: () => void;
}

type OutcomeFilter = "all" | "pending" | "hit_tp" | "hit_sl";

export default function SignalHistory({ refreshKey, onOutcomeChange }: Props) {
  const [signals, setSignals] = useState<SignalHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OutcomeFilter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("signal_history")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setSignals(data as SignalHistory[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const updateOutcome = useCallback(
    async (id: string, outcome: "pending" | "hit_tp" | "hit_sl") => {
      const { error } = await supabase
        .from("signal_history")
        .update({ outcome })
        .eq("id", id);
      if (!error) {
        setSignals((prev) => prev.map((s) => (s.id === id ? { ...s, outcome } : s)));
        onOutcomeChange();
      }
    },
    [onOutcomeChange]
  );

  const deleteSignal = useCallback(async (id: string) => {
    const { error } = await supabase.from("signal_history").delete().eq("id", id);
    if (!error) {
      setSignals((prev) => prev.filter((s) => s.id !== id));
    }
  }, []);

  const exportCSV = useCallback(() => {
    const headers = ["Date", "Coin", "Pattern", "Direction", "Timeframe", "Entry", "TP", "SL", "Outcome"];
    const rows = signals.map((s) => [
      new Date(s.created_at).toLocaleString(),
      s.coin_symbol,
      s.pattern_name,
      s.direction,
      s.timeframe,
      s.entry_price,
      s.tp_price,
      s.sl_price,
      s.outcome,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell)}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `signal_history_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [signals]);

  const tpHits = signals.filter((s) => s.outcome === "hit_tp").length;
  const slHits = signals.filter((s) => s.outcome === "hit_sl").length;
  const resolved = tpHits + slHits;
  const winRate = resolved > 0 ? (tpHits / resolved) * 100 : 0;

  const filtered = filter === "all" ? signals : signals.filter((s) => s.outcome === filter);

  if (loading && signals.length === 0) {
    return (
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Loading signal history…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Signal History</h2>
          <p className="text-xs text-slate-500 mt-0.5">Track past signals and win rate</p>
        </div>
      </div>

      {/* Win rate stats */}
      {signals.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-500 mb-1">Total Signals</p>
            <p className="text-2xl font-bold text-white">{signals.length}</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-500 mb-1">Hit TP</p>
            <p className="text-2xl font-bold text-green-400">{tpHits}</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-500 mb-1">Hit SL</p>
            <p className="text-2xl font-bold text-red-400">{slHits}</p>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
            <p className="text-xs text-slate-500 mb-1">Win Rate</p>
            <p className={`text-2xl font-bold ${winRate >= 50 ? "text-green-400" : "text-amber-400"}`}>
              {resolved > 0 ? `${winRate.toFixed(1)}%` : "—"}
            </p>
          </div>
        </div>
      )}

      {/* Filter pills */}
      {signals.length > 0 && (
        <div className="flex items-center gap-2 mb-3 overflow-x-auto">
          {([
            { key: "all", label: "All" },
            { key: "pending", label: "Pending" },
            { key: "hit_tp", label: "Hit TP" },
            { key: "hit_sl", label: "Hit SL" },
          ] as { key: OutcomeFilter; label: string }[]).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                filter === f.key
                  ? "bg-slate-700 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700/50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {signals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
            <History className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-400 font-medium">No signals recorded yet</p>
          <p className="text-sm text-slate-500 mt-1 max-w-xs">
            When a pattern is detected, save it to your history to track performance over time.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((sig) => {
            const isBullish = sig.direction === "bullish";
            const date = new Date(sig.created_at);
            return (
              <div
                key={sig.id}
                className="rounded-xl bg-slate-900 border border-slate-800 p-3 sm:p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isBullish ? "bg-green-500/10" : "bg-red-500/10"
                      }`}
                    >
                      {isBullish ? (
                        <TrendingUp className="w-4 h-4 text-green-400" />
                      ) : (
                        <TrendingDown className="w-4 h-4 text-red-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {sig.coin_symbol} <span className="text-slate-500 font-normal">· {sig.pattern_name}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        {" · "}
                        {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        {" · "}
                        {sig.timeframe.toUpperCase()}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteSignal(sig.id)}
                    className="text-slate-600 hover:text-red-400 transition-colors shrink-0"
                    title="Delete signal"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="rounded-lg bg-slate-800/50 px-3 py-2">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Entry</p>
                    <p className="text-sm font-medium text-slate-200">{formatPrice(Number(sig.entry_price))}</p>
                  </div>
                  <div className="rounded-lg bg-slate-800/50 px-3 py-2">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">TP</p>
                    <p className="text-sm font-medium text-green-400">{formatPrice(Number(sig.tp_price))}</p>
                  </div>
                  <div className="rounded-lg bg-slate-800/50 px-3 py-2">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">SL</p>
                    <p className="text-sm font-medium text-red-400">{formatPrice(Number(sig.sl_price))}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={sig.outcome}
                    onChange={(e) => updateOutcome(sig.id, e.target.value as "pending" | "hit_tp" | "hit_sl")}
                    className={`text-xs font-medium rounded-lg px-3 py-1.5 border transition-colors outline-none ${
                      sig.outcome === "hit_tp"
                        ? "bg-green-500/10 border-green-500/20 text-green-400"
                        : sig.outcome === "hit_sl"
                        ? "bg-red-500/10 border-red-500/20 text-red-400"
                        : "bg-slate-800 border-slate-700 text-slate-400"
                    }`}
                  >
                    <option value="pending">Pending</option>
                    <option value="hit_tp">Hit TP</option>
                    <option value="hit_sl">Hit SL</option>
                  </select>
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${
                      isBullish ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"
                    }`}
                  >
                    {isBullish ? "Long" : "Short"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
