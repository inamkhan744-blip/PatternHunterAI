import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  X,
  Users,
  DollarSign,
  Crown,
  Ban,
  Megaphone,
  Wrench,
  BarChart3,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { DEFAULT_PRO_DAILY_TRADE_LIMIT } from "../lib/SubscriptionManager";
import {
  DEFAULT_SYSTEM_SETTINGS,
  fetchSystemSettings,
  invalidateSystemSettingsCache,
  saveSystemSettings,
  type SystemSettings,
} from "../lib/SystemSettings";

interface SuperAdminPanelProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  /** Lets App.tsx apply maintenance/feature changes immediately after a save. */
  onSettingsChanged?: (settings: SystemSettings) => void;
}

interface AdminUserRow {
  id: string;
  email?: string | null;
  role?: string | null;
  subscription_tier?: string | null;
  subscription_status?: string | null;
  is_banned?: boolean | null;
  created_at?: string | null;
}

interface PlatformStats {
  totalUsers: number;
  proUsers: number;
  bannedUsers: number;
  estimatedRevenue: number;
}

type Tab = "analytics" | "users" | "system" | "broadcast";

const TABS: Array<{ key: Tab; label: string; icon: typeof BarChart3 }> = [
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "users", label: "User Management", icon: Users },
  { key: "system", label: "System Controls", icon: Wrench },
  { key: "broadcast", label: "Global Broadcast", icon: Megaphone },
];

const PRO_TIERS = new Set(["pro", "premium"]);

function isProTier(row: AdminUserRow): boolean {
  const tier = (row.subscription_tier ?? "free").toLowerCase();
  const status = (row.subscription_status ?? "active").toLowerCase();
  return PRO_TIERS.has(tier) && (status === "active" || status === "trialing");
}

export default function SuperAdminPanel({
  open,
  onClose,
  isAdmin,
  onSettingsChanged,
}: SuperAdminPanelProps) {
  const [tab, setTab] = useState<Tab>("analytics");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [actionUserId, setActionUserId] = useState<string | null>(null);

  const [settings, setSettings] = useState<SystemSettings>({ ...DEFAULT_SYSTEM_SETTINGS });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [broadcastDraft, setBroadcastDraft] = useState("");
  const [broadcastSaving, setBroadcastSaving] = useState(false);

  const [rpcStats, setRpcStats] = useState<PlatformStats | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const localStats = useMemo<PlatformStats>(() => {
    const proUsers = users.filter(isProTier).length;
    return {
      totalUsers: users.length,
      proUsers,
      bannedUsers: users.filter((row) => row.is_banned === true).length,
      estimatedRevenue: proUsers * 10,
    };
  }, [users]);

  const stats = rpcStats ?? localStats;

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        setUsersError(error.message);
        setUsers([]);
        return;
      }
      setUsers((data ?? []) as AdminUserRow[]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_platform_stats");
    if (error || !data) {
      // Migration not applied yet (or RPC unavailable): the list-based totals below
      // still render correct cards from the rows the admin can already read.
      setRpcStats(null);
      return;
    }
    const raw = data as Record<string, unknown>;
    setRpcStats({
      totalUsers: Number(raw.total_users) || 0,
      proUsers: Number(raw.pro_users) || 0,
      bannedUsers: Number(raw.banned_users) || 0,
      estimatedRevenue: Number(raw.estimated_revenue) || 0,
    });
  }, []);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const next = await fetchSystemSettings(true);
      setSettings(next);
      setBroadcastDraft(next.broadcastMessage);
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadUsers(), loadStats(), loadSettings()]);
  }, [loadUsers, loadStats, loadSettings]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    setTab("analytics");
    void refreshAll();
  }, [open, isAdmin, refreshAll]);

  const handleUpgradeToPro = async (row: AdminUserRow) => {
    setActionUserId(row.id);
    try {
      const { error } = await supabase.rpc("admin_set_user_subscription", {
        p_user_id: row.id,
        p_tier: "pro",
        p_status: "active",
        // Keep the trade quota in sync with the Pro tier instead of leaving the
        // user on the free 5-trade limit.
        p_daily_limit: DEFAULT_PRO_DAILY_TRADE_LIMIT,
      });
      if (error) throw new Error(error.message);
      setToast({ type: "success", message: `${row.email ?? row.id} upgraded to Pro.` });
      await Promise.all([loadUsers(), loadStats()]);
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Could not upgrade the user.",
      });
    } finally {
      setActionUserId(null);
    }
  };

  const handleToggleBan = async (row: AdminUserRow) => {
    const nextBanned = !row.is_banned;
    setActionUserId(row.id);
    try {
      const { error } = await supabase.rpc("admin_set_user_ban", {
        p_user_id: row.id,
        p_banned: nextBanned,
      });
      if (error) throw new Error(error.message);
      setToast({
        type: "success",
        message: `${row.email ?? row.id} ${nextBanned ? "banned" : "unbanned"}.`,
      });
      await Promise.all([loadUsers(), loadStats()]);
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Could not update the ban status.",
      });
    } finally {
      setActionUserId(null);
    }
  };

  const applySettings = async (patch: Partial<SystemSettings>, successMessage: string) => {
    setSettingsSaving(true);
    try {
      const saved = await saveSystemSettings(patch);
      invalidateSystemSettingsCache();
      setSettings(saved);
      onSettingsChanged?.(saved);
      setToast({ type: "success", message: successMessage });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Could not save the system settings.",
      });
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleBroadcast = async () => {
    const message = broadcastDraft.trim();
    if (!message) {
      setToast({ type: "error", message: "Write a message before broadcasting." });
      return;
    }
    setBroadcastSaving(true);
    try {
      const saved = await saveSystemSettings({ broadcastMessage: message });
      invalidateSystemSettingsCache();
      setSettings(saved);
      onSettingsChanged?.(saved);
      setToast({ type: "success", message: "Broadcast sent to all users." });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Could not send the broadcast.",
      });
    } finally {
      setBroadcastSaving(false);
    }
  };

  const handleClearBroadcast = async () => {
    setBroadcastSaving(true);
    try {
      const saved = await saveSystemSettings({ broadcastMessage: "" });
      invalidateSystemSettingsCache();
      setSettings(saved);
      setBroadcastDraft("");
      onSettingsChanged?.(saved);
      setToast({ type: "success", message: "Broadcast cleared." });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Could not clear the broadcast.",
      });
    } finally {
      setBroadcastSaving(false);
    }
  };

  if (!open || !isAdmin) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-2 sm:p-4 bg-black/90 backdrop-blur-md font-sans">
      <div className="relative w-full max-w-5xl h-[92vh] bg-[#070b14] border border-emerald-500/30 rounded-2xl shadow-2xl shadow-emerald-950/40 overflow-hidden flex flex-col text-white">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-slate-800 bg-[#050810] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-950/50">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-wider uppercase font-mono">
                Super Admin Panel
              </h2>
              <p className="text-[11px] text-slate-400">
                Platform analytics, users, system controls &amp; broadcast
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={usersLoading || settingsLoading}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-50"
              title="Refresh"
            >
              {usersLoading || settingsLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              aria-label="Close Super Admin Panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-2 sm:px-4 pt-3 flex gap-1 overflow-x-auto border-b border-slate-800 bg-[#070b14]">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wide font-mono rounded-t-lg border-b-2 whitespace-nowrap transition-colors ${
                tab === key
                  ? "text-emerald-300 border-emerald-400 bg-emerald-500/10"
                  : "text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Toast */}
        {toast && (
          <div
            role="status"
            className={`mx-4 mt-3 px-3 py-2 rounded-lg border text-[11px] font-mono flex items-center gap-2 ${
              toast.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-200"
                : "bg-red-500/10 border-red-500/40 text-red-200"
            }`}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5" />
            )}
            <span className="flex-1">{toast.message}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss message">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {tab === "analytics" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard
                  label="Total Users"
                  value={stats.totalUsers.toLocaleString()}
                  icon={<Users className="w-5 h-5 text-cyan-300" />}
                  accent="border-cyan-500/30"
                />
                <StatCard
                  label="Total Pro Users"
                  value={stats.proUsers.toLocaleString()}
                  icon={<Crown className="w-5 h-5 text-amber-300" />}
                  accent="border-amber-500/30"
                />
                <StatCard
                  label="Estimated Revenue"
                  value={`$${stats.estimatedRevenue.toLocaleString()}`}
                  hint="Pro users × $10 / month"
                  icon={<DollarSign className="w-5 h-5 text-emerald-300" />}
                  accent="border-emerald-500/30"
                />
              </div>

              <div className="p-4 rounded-xl bg-[#0b101c] border border-slate-800">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] font-mono text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    Active Pro: <strong className="text-emerald-300">{stats.proUsers}</strong>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Ban className="w-3.5 h-3.5 text-red-400" />
                    Banned: <strong className="text-red-300">{stats.bannedUsers}</strong>
                  </span>
                  <span>
                    Source:{" "}
                    {rpcStats ? "admin_platform_stats()" : "user_profiles (client tally)"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {tab === "users" && (
            <div className="space-y-3">
              {usersError && (
                <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/40 text-[11px] text-red-200 font-mono">
                  Could not load users: {usersError}
                </div>
              )}

              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] font-mono">
                    <thead className="bg-[#0b101c] text-slate-400 uppercase tracking-wide">
                      <tr>
                        <th className="px-3 py-2 font-bold">Email</th>
                        <th className="px-3 py-2 font-bold">Role</th>
                        <th className="px-3 py-2 font-bold">Subscription</th>
                        <th className="px-3 py-2 font-bold">Status</th>
                        <th className="px-3 py-2 font-bold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {usersLoading && users.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                            Loading users…
                          </td>
                        </tr>
                      )}
                      {!usersLoading && users.length === 0 && !usersError && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                            No user profiles found.
                          </td>
                        </tr>
                      )}
                      {users.map((row) => {
                        const busy = actionUserId === row.id;
                        const pro = isProTier(row);
                        const banned = row.is_banned === true;
                        return (
                          <tr key={row.id} className={banned ? "bg-red-950/20" : undefined}>
                            <td className="px-3 py-2 text-slate-200 max-w-[220px] truncate">
                              {row.email ?? row.id}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase ${
                                  row.role === "admin"
                                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                    : row.role === "staff"
                                      ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                                      : "bg-slate-800 text-slate-300 border-slate-700"
                                }`}
                              >
                                {row.role ?? "user"}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase ${
                                  pro
                                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                    : "bg-slate-800 text-slate-300 border-slate-700"
                                }`}
                              >
                                {row.subscription_tier ?? "free"}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {banned ? (
                                <span className="text-red-300 font-bold">BANNED</span>
                              ) : (
                                <span className="text-slate-400">
                                  {row.subscription_status ?? "active"}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void handleUpgradeToPro(row)}
                                  disabled={busy || pro}
                                  className="px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed font-bold"
                                  title={pro ? "Already on a Pro tier" : "Upgrade to Pro"}
                                >
                                  {busy ? "…" : "Upgrade to Pro"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleToggleBan(row)}
                                  disabled={busy || row.role === "admin"}
                                  className={`px-2 py-1 rounded border font-bold disabled:opacity-40 disabled:cursor-not-allowed ${
                                    banned
                                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                                      : "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                                  }`}
                                  title={
                                    row.role === "admin"
                                      ? "Admins cannot be banned"
                                      : banned
                                        ? "Unban user"
                                        : "Ban user"
                                  }
                                >
                                  {busy ? "…" : banned ? "Unban User" : "Ban User"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-[10px] text-slate-500 font-mono">
                {users.length} profile{users.length === 1 ? "" : "s"} · writes go through the
                admin_* SECURITY DEFINER RPCs and are audit-logged.
              </p>
            </div>
          )}

          {tab === "system" && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-[#0b101c] border border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">
                      Maintenance Mode
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Shows a full-screen “App is under maintenance” notice to every non-admin.
                    </span>
                  </div>
                  <Toggle
                    checked={settings.maintenanceMode}
                    disabled={settingsLoading || settingsSaving}
                    onChange={(checked) =>
                      void applySettings(
                        { maintenanceMode: checked },
                        checked ? "Maintenance mode enabled." : "Maintenance mode disabled."
                      )
                    }
                  />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0b101c] border border-slate-800 space-y-3">
                <span className="text-xs font-bold text-slate-200 block font-mono uppercase tracking-wide">
                  Feature Toggles
                </span>
                <FeatureToggle
                  label="Vision AI"
                  description="Chart screenshot analysis entry points."
                  checked={settings.enableVisionAI}
                  disabled={settingsLoading || settingsSaving}
                  onChange={(checked) =>
                    void applySettings(
                      { enableVisionAI: checked },
                      `Vision AI ${checked ? "enabled" : "disabled"}.`
                    )
                  }
                />
                <FeatureToggle
                  label="Auto-Pilot"
                  description="Auto-Pilot toggle and Auto-Trade engine access."
                  checked={settings.enableAutopilot}
                  disabled={settingsLoading || settingsSaving}
                  onChange={(checked) =>
                    void applySettings(
                      { enableAutopilot: checked },
                      `Auto-Pilot ${checked ? "enabled" : "disabled"}.`
                    )
                  }
                />
                <FeatureToggle
                  label="Telegram Alerts"
                  description="Telegram bot token / chat ID settings."
                  checked={settings.enableTelegram}
                  disabled={settingsLoading || settingsSaving}
                  onChange={(checked) =>
                    void applySettings(
                      { enableTelegram: checked },
                      `Telegram alerts ${checked ? "enabled" : "disabled"}.`
                    )
                  }
                />
              </div>

              <p className="text-[10px] text-slate-500 font-mono">
                Saved to global_settings (id = global_config). Feature flags fail open if the
                column is missing.
              </p>
            </div>
          )}

          {tab === "broadcast" && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-[#0b101c] border border-slate-800 space-y-3">
                <label className="text-xs font-bold text-slate-200 block font-mono uppercase tracking-wide">
                  Message to all users
                </label>
                <textarea
                  value={broadcastDraft}
                  onChange={(e) => setBroadcastDraft(e.target.value.slice(0, 500))}
                  rows={4}
                  placeholder="e.g. Scheduled maintenance tonight 22:00–23:00 UTC. Auto-Pilot will be paused."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono resize-none"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {broadcastDraft.length}/500 · shown as a dismissible banner
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleClearBroadcast()}
                      disabled={broadcastSaving || !settings.broadcastMessage}
                      className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 text-[11px] font-bold hover:bg-slate-700 disabled:opacity-40 font-mono"
                    >
                      Clear Broadcast
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBroadcast()}
                      disabled={broadcastSaving || !broadcastDraft.trim()}
                      className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-[11px] font-bold uppercase tracking-wide flex items-center gap-1.5 disabled:opacity-50 font-mono"
                    >
                      {broadcastSaving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Megaphone className="w-3.5 h-3.5" />
                      )}
                      Send Broadcast
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#0b101c] border border-slate-800 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 font-mono">
                  Live banner preview
                </span>
                {settings.broadcastMessage ? (
                  <div className="mt-1 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/40 text-cyan-100 text-[11px] flex items-center gap-2">
                    <Megaphone className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                    <span className="flex-1">{settings.broadcastMessage}</span>
                    <X className="w-3.5 h-3.5 text-cyan-300/70" />
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 font-mono">No active broadcast.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  accent: string;
}) {
  return (
    <div className={`p-4 rounded-xl bg-[#0b101c] border ${accent} space-y-2`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 font-mono">
          {label}
        </span>
        {icon}
      </div>
      <span className="text-2xl font-black font-mono text-white block leading-none">{value}</span>
      {hint && <span className="text-[10px] text-slate-500 font-mono block">{hint}</span>}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full border transition-colors disabled:opacity-50 shrink-0 ${
        checked
          ? "bg-emerald-500/30 border-emerald-400"
          : "bg-slate-800 border-slate-600"
      }`}
    >
      <span
        className={`absolute top-0.5 rounded-full transition-all ${
          checked ? "left-[22px] bg-emerald-300" : "left-0.5 bg-slate-400"
        }`}
        style={{ width: 18, height: 18 }}
      />
    </button>
  );
}

function FeatureToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <div>
        <span className="text-[11px] font-bold text-slate-200 block">{label}</span>
        <span className="text-[10px] text-slate-500">{description}</span>
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-emerald-500"
      />
    </label>
  );
}
