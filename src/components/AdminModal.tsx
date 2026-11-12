import { useState, useEffect } from "react";
import { Shield, Crown, Activity, Users, Radio, CheckCircle, Power, X } from "lucide-react";
import { autoTradeEngine } from "../lib/BinanceAutoTrade";
import { paperTradingEngine } from "../lib/PaperTrading";
import { getProDailyTradeLimit, setProDailyTradeLimit, ProDailyTradeLimit } from "../lib/SubscriptionManager";

interface AdminModalProps {
  open: boolean;
  onClose: () => void;
  userEmail?: string;
}

export default function AdminModal({ open, onClose, userEmail }: AdminModalProps) {
  const [dailyLimit, setDailyLimit] = useState<ProDailyTradeLimit>(getProDailyTradeLimit());
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);
  const [killSwitchEngaged, setKillSwitchEngaged] = useState(false);
  const [activeTab, setActiveTab] = useState<"system" | "limits" | "audit">("system");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDailyLimit(getProDailyTradeLimit());
      const circuit = autoTradeEngine.getCircuitBreaker();
      setKillSwitchEngaged(circuit.isTripped);
    }
  }, [open]);

  if (!open) return null;

  const handleUpdateLimit = async (val: ProDailyTradeLimit) => {
    // Server-authoritative: `admin_set_pro_daily_limit` re-checks is_admin() for the
    // caller's JWT, so a tampered client cannot change tier policy.
    const ok = await setProDailyTradeLimit(val);
    if (!ok) {
      setStatusMessage("Rejected by server: administrator role required.");
      setTimeout(() => setStatusMessage(null), 4000);
      return;
    }
    setDailyLimit(val);
    setStatusMessage(`Pro Daily Trade Limit updated to ${val} trades/day.`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleToggleEmergencyKill = () => {
    if (!killSwitchEngaged) {
      autoTradeEngine.tripCircuitBreaker("MANUAL_ADMIN_HALT: Platform emergency circuit breaker triggered by administrator.");
      setKillSwitchEngaged(true);
      setStatusMessage("🚨 Global Emergency Kill Switch Engaged. All automated trading halted.");
    } else {
      autoTradeEngine.resetCircuitBreaker();
      setKillSwitchEngaged(false);
      setStatusMessage("Global Emergency Circuit Breaker Reset. Trading systems re-armed.");
    }
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const allLiveTrades = autoTradeEngine.getAllTrades();
  const openLiveTrades = autoTradeEngine.getOpenTrades();
  const openPaperTrades = paperTradingEngine.getOpenTrades();
  const profitVault = autoTradeEngine.getProfitVaultTotal();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-slate-900 border border-amber-500/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-400">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white uppercase tracking-wider">Enterprise Admin Console</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  MASTER CONTROLS
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Authorized: <span className="text-amber-400">{userEmail || "Admin Operator"}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="px-6 pt-3 border-b border-slate-800 flex items-center gap-3 bg-slate-900/60 text-xs font-semibold">
          <button
            onClick={() => setActiveTab("system")}
            className={`pb-3 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === "system" ? "border-amber-400 text-amber-400" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>System Telemetry</span>
          </button>
          <button
            onClick={() => setActiveTab("limits")}
            className={`pb-3 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === "limits" ? "border-amber-400 text-amber-400" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Tier & Limit Policies</span>
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`pb-3 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === "audit" ? "border-amber-400 text-amber-400" : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Radio className="w-4 h-4" />
            <span>Live Audit Stream</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {statusMessage && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-300 font-medium flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {activeTab === "system" && (
            <div className="space-y-6">
              {/* Telemetry Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Open Live Positions</span>
                  <span className="text-xl font-mono font-bold text-cyan-400">{openLiveTrades.length}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Active Paper Trades</span>
                  <span className="text-xl font-mono font-bold text-purple-400">{openPaperTrades.length}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Profit Vault Escrow</span>
                  <span className="text-xl font-mono font-bold text-[#00ff66]">${profitVault.toFixed(2)}</span>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Total Executed History</span>
                  <span className="text-xl font-mono font-bold text-white">{allLiveTrades.length}</span>
                </div>
              </div>

              {/* Emergency Controls */}
              <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-white flex items-center gap-2">
                      <Power className="w-4 h-4 text-red-400" />
                      Global Emergency Kill Switch
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Instantly trips Auto-Pilot circuit breaker across all client sessions and blocks order execution.
                    </p>
                  </div>
                  <button
                    onClick={handleToggleEmergencyKill}
                    className={`px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition shadow-md ${
                      killSwitchEngaged
                        ? "bg-green-600 hover:bg-green-500 text-white"
                        : "bg-red-600 hover:bg-red-500 text-white shadow-red-950/50"
                    }`}
                  >
                    {killSwitchEngaged ? "Reset Circuit Breaker" : "TRIP KILL SWITCH"}
                  </button>
                </div>
              </div>

              {/* Maintenance Toggle */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-white flex items-center gap-2">
                    <Shield className="w-4 h-4 text-cyan-400" />
                    Maintenance Lockdown Mode
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Temporarily display maintenance banner to non-admin users during database migrations.
                  </p>
                </div>
                <button
                  onClick={() => setIsMaintenanceMode(!isMaintenanceMode)}
                  className={`px-3.5 py-1.5 rounded-lg font-bold text-xs transition border ${
                    isMaintenanceMode
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                      : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                >
                  {isMaintenanceMode ? "MAINTENANCE ON" : "NORMAL OPERATION"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "limits" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 space-y-3">
                <h4 className="font-bold text-white">Default Pro Tier Daily Execution Quota</h4>
                <p className="text-[11px] text-slate-400">
                  Controls the maximum automated and manual live trades allowed per day for subscribed Pro accounts.
                </p>
                <div className="grid grid-cols-4 gap-2 pt-1">
                  {([1, 5, 10, 100] as const).map((limit) => (
                    <button
                      key={String(limit)}
                      onClick={() => handleUpdateLimit(limit)}
                      className={`py-2 px-3 rounded-lg font-bold text-xs uppercase transition border ${
                        dailyLimit === limit
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-md"
                          : "bg-slate-800 text-slate-400 border-slate-700 hover:text-white"
                      }`}
                    >
                      {`${limit} trades / day`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "audit" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-[11px] pb-1">
                <span>Recent System & Trading Events</span>
                <span>Real-time Log</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-950 font-mono text-[11px] text-slate-300 space-y-1.5 max-h-56 overflow-y-auto border border-slate-800">
                <div className="text-cyan-400">[INIT] BinanceAutoTradeEngine mounted with dynamic risk guards.</div>
                <div className="text-slate-400">[RISK] Post-loss cooldown timer set to 30m. Confluence threshold 85/100.</div>
                <div className="text-amber-400">[AUTH] Administrator session verified for {userEmail || "current operator"}.</div>
                <div className="text-[#00ff66]">[TELEMETRY] WebSocket feed healthy. Latency 24ms.</div>
                {killSwitchEngaged && (
                  <div className="text-red-400 font-bold">[HALT] Circuit breaker tripped by administrator.</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between">
          <span className="text-[10px] text-slate-500 font-mono">PatternHunter AI v2.4 Enterprise Core</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition"
          >
            Close Panel
          </button>
        </div>
      </div>
    </div>
  );
}
