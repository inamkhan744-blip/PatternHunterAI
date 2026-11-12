import { useState, useEffect, useCallback } from "react";
import {
  BookOpen,
  Plus,
  Sparkles,
  Flame,
  ShieldCheck,
  AlertCircle,
  Trash2,
  Calendar,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { JournalEntry, UserStats } from "../types";

export default function TradingJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [stats, setStats] = useState<UserStats>({
    discipline_streak: 0,
    best_streak: 0,
    total_journal_entries: 0,
    rules_followed_count: 0,
    rules_broken_count: 0,
  });
  const [_loading, setLoading] = useState(true);
  void _loading;
  const [showAddModal, setShowAddModal] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [coinSymbol, setCoinSymbol] = useState("BTC");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [emotion, setEmotion] = useState("calm");
  const [strategy, setStrategy] = useState("SMC_OrderBlock");
  const [followedRules, setFollowedRules] = useState(true);
  const [notes, setNotes] = useState("");

  const fetchJournalData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: journalData } = await supabase
        .from("journal_entries")
        .select("*")
        .order("created_at", { ascending: false });

      if (journalData) {
        setEntries(journalData as JournalEntry[]);
      }

      const { data: statsData } = await supabase
        .from("user_stats")
        .select("*")
        .maybeSingle();

      if (statsData) {
        setStats(statsData as UserStats);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJournalData();
  }, [fetchJournalData]);

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    const entryNum = parseFloat(entryPrice) || 0;
    const exitNum = parseFloat(exitPrice) || 0;
    const isWin = direction === "long" ? exitNum >= entryNum : exitNum <= entryNum;
    const outcome = isWin ? "win" : "loss";

    // Deterministic review of the recorded discipline data — not an AI call, and it is
    // labelled as such in the UI.
    let review = `Reviewed ${coinSymbol.toUpperCase()} ${direction.toUpperCase()} entry $${entryNum} → exit $${exitNum} (${outcome.toUpperCase()}) using ${strategy}. `;
    if (followedRules) {
      review += `Rules followed. Risk discipline maintained and the recorded emotional state was '${emotion}'.`;
    } else {
      review += `Rule deviation flagged with emotional state '${emotion}'. Corrective action: enforce the hard stop-loss and only enter high-confluence zones.`;
    }

    setMessage(null);

    try {
      const { error: insertError } = await supabase.from("journal_entries").insert({
        coin_symbol: coinSymbol.toUpperCase(),
        binance_symbol: `${coinSymbol.toUpperCase()}USDT`,
        direction,
        pattern_name: strategy,
        emotion,
        entry_price: entryNum,
        tp_price: exitNum,
        outcome,
        followed_rules: followedRules,
        notes,
        ai_analysis: review,
      });

      if (insertError) throw new Error(insertError.message);

      const newStreak = followedRules ? stats.discipline_streak + 1 : 0;
      const newBest = Math.max(stats.best_streak, newStreak);
      const newFollowed = stats.rules_followed_count + (followedRules ? 1 : 0);
      const newBroken = stats.rules_broken_count + (followedRules ? 0 : 1);

      const { error: statsError } = await supabase.from("user_stats").upsert(
        {
          discipline_streak: newStreak,
          best_streak: newBest,
          total_journal_entries: entries.length + 1,
          rules_followed_count: newFollowed,
          rules_broken_count: newBroken,
        },
        // user_stats is UNIQUE on user_id; without this the second entry inserts a new
        // row and violates the constraint, silently freezing the streak counters.
        { onConflict: "user_id" }
      );

      if (statsError) {
        setMessage({
          type: "error",
          text: `Entry saved, but discipline stats could not be updated: ${statsError.message}`,
        });
      } else {
        setMessage({ type: "success", text: "Journal entry saved." });
      }

      setShowAddModal(false);
      fetchJournalData();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      console.error("Journal insert error:", err);
      setMessage({ type: "error", text: `Could not save the journal entry: ${reason}` });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this journal entry? This cannot be undone.")) return;
    const { error } = await supabase.from("journal_entries").delete().eq("id", id);
    if (error) {
      setMessage({ type: "error", text: `Could not delete the entry: ${error.message}` });
      return;
    }
    setMessage({ type: "success", text: "Journal entry deleted." });
    fetchJournalData();
  };

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 font-mono">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800 flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-cyan-400" />
            Institutional Trading Journal & Review
          </h2>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Log trade entries, audit psychology, track rule discipline streaks, and receive an automated review of each session.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-lg shadow-cyan-950/40 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New Journal Log</span>
        </button>
      </div>

      {message && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
            message.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/40 bg-red-950/40 text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 my-6">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans">
              Discipline Streak
            </span>
            <span className="text-2xl font-black text-amber-400 flex items-center gap-1">
              <Flame className="w-5 h-5 text-amber-400 fill-amber-400" />
              {stats.discipline_streak} Sessions
            </span>
          </div>
          <span className="text-xs text-slate-500 font-sans">Best: {stats.best_streak}</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans">
            Rules Followed
          </span>
          <span className="text-2xl font-black text-[#00ff66] flex items-center gap-1">
            <ShieldCheck className="w-5 h-5 text-[#00ff66]" />
            {stats.rules_followed_count}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans">
            Rules Broken
          </span>
          <span className="text-2xl font-black text-[#ff3344] flex items-center gap-1">
            <AlertCircle className="w-5 h-5 text-[#ff3344]" />
            {stats.rules_broken_count}
          </span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-sans">
            Total Logged Trades
          </span>
          <span className="text-2xl font-black text-cyan-400">
            {entries.length}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {entries.length === 0 ? (
          <div className="p-12 text-center rounded-xl bg-slate-900/50 border border-slate-800 text-slate-500">
            <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No journal entries logged yet.</p>
            <p className="text-xs mt-1">Start tracking your executions and discipline habits above.</p>
          </div>
        ) : (
          entries.map((item) => (
            <div
              key={item.id}
              className="p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-3"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-white">{item.coin_symbol}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                      item.direction === "long" ? "bg-emerald-500/20 text-[#00ff66]" : "bg-red-500/20 text-[#ff3344]"
                    }`}
                  >
                    {item.direction}
                  </span>
                  <span className="text-xs text-slate-400">· Strategy: {item.pattern_name}</span>
                </div>

                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="text-slate-500 hover:text-red-400 transition"
                    title="Delete log entry"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-6 text-xs text-slate-300 flex-wrap">
                <div>
                  <span className="text-slate-500">Entry: </span>
                  <span className="font-bold">${item.entry_price}</span>
                </div>
                <div>
                  <span className="text-slate-500">Exit / Target: </span>
                  <span className="font-bold">${item.tp_price}</span>
                </div>
                <div>
                  <span className="text-slate-500">Psychology: </span>
                  <span className="font-bold capitalize text-cyan-300">{item.emotion}</span>
                </div>
                <div>
                  <span className="text-slate-500">Discipline: </span>
                  <span className={`font-bold ${item.followed_rules ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
                    {item.followed_rules ? "Followed Plan" : "Broke Rules"}
                  </span>
                </div>
              </div>

              {item.notes && (
                <p className="text-xs text-slate-400 font-sans italic bg-slate-950 p-2.5 rounded border border-slate-800">
                  "{item.notes}"
                </p>
              )}

              {item.ai_analysis && (
                <div className="p-3 rounded-lg bg-cyan-950/20 border border-cyan-500/30 text-xs text-cyan-300 flex items-start gap-2 font-sans">
                  <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-cyan-200 uppercase tracking-wider block font-mono text-[10px]">
                      Automated Review (rules & risk):
                    </span>
                    <p className="mt-0.5 text-slate-300 leading-relaxed">{item.ai_analysis}</p>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-cyan-400" />
              Log Execution in Trading Journal
            </h3>

            <form onSubmit={handleAddEntry} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Coin Symbol</label>
                  <input
                    type="text"
                    value={coinSymbol}
                    onChange={(e) => setCoinSymbol(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white uppercase outline-none focus:border-cyan-500"
                    placeholder="BTC"
                    required
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Direction</label>
                  <select
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as "long" | "short")}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
                  >
                    <option value="long">LONG</option>
                    <option value="short">SHORT</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Entry Price</label>
                  <input
                    type="number"
                    step="any"
                    value={entryPrice}
                    onChange={(e) => setEntryPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
                    placeholder="90000"
                    required
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Exit Price</label>
                  <input
                    type="number"
                    step="any"
                    value={exitPrice}
                    onChange={(e) => setExitPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
                    placeholder="92500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Trading Strategy</label>
                <input
                  type="text"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
                  placeholder="SMC_OrderBlock"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Emotional State</label>
                  <select
                    value={emotion}
                    onChange={(e) => setEmotion(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
                  >
                    <option value="calm">Calm & Focused</option>
                    <option value="fomo">FOMO / Impatient</option>
                    <option value="fear">Fear / Anxious</option>
                    <option value="revenge">Revenge Trading</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Followed Rules?</label>
                  <select
                    value={followedRules ? "yes" : "no"}
                    onChange={(e) => setFollowedRules(e.target.value === "yes")}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500"
                  >
                    <option value="yes">Yes (Maintained Discipline)</option>
                    <option value="no">No (Deviated from plan)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Notes / Reflection</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-white outline-none focus:border-cyan-500 resize-none h-20"
                  placeholder="What was the catalyst? Did you wait for candle close?"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
                >
                  Save Log
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
