import React, { useState, useEffect } from "react";
import {
  X,
  Settings as SettingsIcon,
  Download,
  CheckCircle,
  Smartphone,
  Shield,
  Bell,
  Sliders,
  Laptop,
  Sparkles,
  Key,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Crown,
  Webhook,
  Copy,
  Play,
  RotateCw,
  BrainCircuit,
  Loader2,
} from "lucide-react";
import { usePWAInstall } from "../lib/pwa";
import { pushNotificationService } from "../lib/PushNotification";
import { webhookService } from "../lib/WebhookService";
import {
  getCachedCredentialStatus,
  refreshCredentialStatus,
  saveExchangeCredentials as saveVaultCredentials,
  deleteExchangeCredentials,
  clearCredentialCache,
  type CredentialStatus,
} from "../lib/CredentialVault";
import {
  loadTelegramConfig,
  saveTelegramConfig,
  saveTelegramCredentials,
  refreshTelegramStatus,
} from "../lib/TelegramService";
import {
  SUPPORTED_EXCHANGES,
  type ExchangeId,
  getActiveExchange,
  setActiveExchange,
  getExchangeCredentials,
  saveExchangeCredentials,
  testExchangeConnectivity,
} from "../lib/MultiExchange";
import {
  AI_PROVIDER_IDS,
  AI_PROVIDER_META,
  DEFAULT_GLOBAL_AI_CONFIG,
  fetchGlobalAIConfig,
  listConfiguredProviders,
  saveGlobalAIConfig,
  type AIProvider,
  type GlobalAIConfig,
} from "../lib/AIService";
interface Props {
  open: boolean;
  onClose: () => void;
  isAdmin?: boolean;
  onOpenAutoTrade?: () => void;
  onOpenVisionAI?: () => void;
}

interface ToastState {
  type: "success" | "error";
  message: string;
}

/** Which GlobalAIConfig fields back each provider's key + model input. */
const PROVIDER_FIELDS: Record<AIProvider, { key: keyof GlobalAIConfig; model: keyof GlobalAIConfig }> = {
  gemini: { key: "geminiApiKey", model: "geminiModel" },
  deepseek: { key: "deepseekApiKey", model: "deepseekModel" },
  groq: { key: "groqApiKey", model: "groqModel" },
};

export default function SettingsModal({
  open,
  onClose,
  isAdmin: propIsAdmin,
  onOpenAutoTrade,
  onOpenVisionAI,
}: Props) {
  // Admin badge is decided by the server-verified profile passed down from App.
  const isAdmin = propIsAdmin === true;

  const { isStandalone, triggerInstall } = usePWAInstall();
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticFeedback, setHapticFeedback] = useState(true);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(() => pushNotificationService.getPermission());

  // Multi-Exchange tab state
  const [selectedExchange, setSelectedExchange] = useState<ExchangeId>(() => getActiveExchange());
  const [exchangeKey, setExchangeKey] = useState<string>("");
  const [exchangeSecret, setExchangeSecret] = useState<string>("");
  const [exchangePassphrase, setExchangePassphrase] = useState<string>("");
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus>(getCachedCredentialStatus());
  const [testingPing, setTestingPing] = useState(false);
  const [pingResult, setPingResult] = useState<{ success: boolean; latencyMs: number } | null>(null);

  // Telegram Alert State
  const [telegramToken, setTelegramTokenState] = useState<string>("");
  const [telegramChatId, setTelegramChatIdState] = useState<string>("");

  // Show / Hide Password field states
  const [showExchangeKey, setShowExchangeKey] = useState(false);
  const [showExchangeSecret, setShowExchangeSecret] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [showTelegramChatId, setShowTelegramChatId] = useState(false);

  // Toast Notification State
  const [toast, setToast] = useState<ToastState | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Admin-only Global AI Config State
  const [aiConfig, setAiConfig] = useState<GlobalAIConfig>(() => ({ ...DEFAULT_GLOBAL_AI_CONFIG }));
  const [aiConfigLoading, setAiConfigLoading] = useState(false);
  const [aiConfigSaving, setAiConfigSaving] = useState(false);
  const [visibleAiKeys, setVisibleAiKeys] = useState<Record<AIProvider, boolean>>({
    gemini: false,
    deepseek: false,
    groq: false,
  });

  // TradingView Webhook State
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [testAction, setTestAction] = useState<"BUY" | "SELL">("BUY");
  const [testSymbol, setTestSymbol] = useState("BTCUSDT");

  // Load stored credentials when opening modal or changing exchange
  useEffect(() => {
    if (!open) return;
    setCredentialStatus(getCachedCredentialStatus());
    if (selectedExchange === "binance") {
      // Server-side vault: stored secrets are never returned to the browser.
      setExchangeKey("");
      setExchangeSecret("");
      setExchangePassphrase("");
      void refreshCredentialStatus().then(setCredentialStatus);
    } else {
      void getExchangeCredentials(selectedExchange).then((creds) => {
        setExchangeKey(creds.apiKey || "");
        setExchangeSecret(creds.apiSecret || "");
        setExchangePassphrase(creds.passphrase || "");
      });
    }

    // The bot token is no longer stored in the browser; only its status is known.
    const tg = loadTelegramConfig();
    setTelegramTokenState("");
    setTelegramChatIdState(tg.chatId || "");
    void refreshTelegramStatus().then((status) => {
      setTelegramChatIdState(status.chatId || "");
    });

    setWebhookUrl(webhookService.getWebhookUrl());

    setPingResult(null);
    setPushPermission(pushNotificationService.getPermission());
    setToast(null);
    setSaveSuccess(false);
  }, [open, selectedExchange]);

  // Load the admin-managed AI configuration. Only admins see (or may write) it;
  // RLS on global_settings enforces the same rule server-side.
  useEffect(() => {
    if (!open || !isAdmin) return;
    let cancelled = false;
    setAiConfigLoading(true);
    void fetchGlobalAIConfig(true)
      .then((config) => {
        if (!cancelled) setAiConfig(config);
      })
      .catch((err) => {
        if (!cancelled) {
          setToast({
            type: "error",
            message: err instanceof Error ? err.message : "Failed to load the global AI configuration.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setAiConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isAdmin]);

  const updateAiConfig = (patch: Partial<GlobalAIConfig>) => {
    setAiConfig((prev) => ({ ...prev, ...patch }));
  };

  const setProviderField = (provider: AIProvider, field: "key" | "model", value: string) => {
    const target = PROVIDER_FIELDS[provider][field];
    setAiConfig((prev) => ({ ...prev, [target]: value }) as GlobalAIConfig);
  };

  const handleSaveGlobalAIConfig = async () => {
    if (!isAdmin) return;
    setAiConfigSaving(true);
    try {
      const saved = await saveGlobalAIConfig(aiConfig);
      setAiConfig(saved);
      setToast({
        type: "success",
        message: `Global AI config saved. Active provider: ${AI_PROVIDER_META[saved.activeProvider].label}.`,
      });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save the global AI configuration.",
      });
    } finally {
      setAiConfigSaving(false);
    }
  };

  const handleRequestPushPermission = async () => {
    const res = await pushNotificationService.requestPermission();
    setPushPermission(res);
    if (res === "granted") {
      setToast({ type: "success", message: "Push notifications granted! You'll now receive trade alerts in the background." });
    } else {
      setToast({ type: "error", message: "Push notification permission denied in browser." });
    }
  };

  const handleSendTestPush = async () => {
    if (pushPermission !== "granted") {
      await handleRequestPushPermission();
    }
    await pushNotificationService.sendNotification({
      title: "⚡ Fortress Alert: Trade Execution Test",
      body: "LONG BTCUSDT filled at $65,240. Trailing Stop Loss & OCO are actively protecting your position.",
    });
    setToast({ type: "success", message: "Test push notification dispatched to your device!" });
  };

  const handleCopyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedUrl(true);
    setToast({ type: "success", message: "Webhook URL copied to clipboard!" });
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopySamplePayload = () => {
    const payload = webhookService.getSampleJsonPayload(testSymbol, testAction.toLowerCase() as "buy" | "sell");
    navigator.clipboard.writeText(payload);
    setCopiedPayload(true);
    setToast({ type: "success", message: "Sample JSON payload copied to clipboard!" });
    setTimeout(() => setCopiedPayload(false), 2000);
  };

    const handleRegenerateWebhookToken = async () => {
    const confirmed = window.confirm(
      "Regenerate the webhook token? Existing TradingView alerts will stop working until you update them."
    );
    if (!confirmed) return;

    try {
      await webhookService.regenerateToken();
      setWebhookUrl(webhookService.getWebhookUrl());
      setToast({ type: "success", message: "New server-issued webhook token generated!" });
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to rotate the webhook token.",
      });
    }
  };

  const handleSimulateWebhook = () => {
    webhookService.dispatchSignal({
      direction: testAction,
      symbol: testSymbol.toUpperCase(),
      source: "TradingView Webhook Test",
      rawPayload: webhookService.getSampleJsonPayload(testSymbol, testAction.toLowerCase() as "buy" | "sell"),
    });
    setToast({
      type: "success",
      message: `Simulated TradingView Webhook [${testAction} ${testSymbol.toUpperCase()}] dispatched!`,
    });
  };

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!open) return null;

  const handleDeleteStoredCredentials = async () => {
    if (!window.confirm("Delete the stored Binance API credentials? Live trading will stop until new keys are saved.")) {
      return;
    }
    try {
      await deleteExchangeCredentials("binance");
      clearCredentialCache();
      setCredentialStatus(getCachedCredentialStatus());
      setToast({ type: "success", message: "Stored Binance credentials deleted from the server vault." });
    } catch (err) {
      setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to delete stored credentials." });
    }
  };

  const handleSaveApiConfiguration = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    setActiveExchange(selectedExchange);

    // 1. Persist exchange API keys
    if (selectedExchange === "binance") {
      if (!exchangeKey.trim() || !exchangeSecret.trim()) {
        setToast({ type: "error", message: "Enter both the API key and secret so they can be stored securely." });
        return;
      }
      try {
        // Sent once over TLS to the `binance-credentials` edge function, which
        // encrypts with AES-256-GCM using a server-only key. Never stored locally.
        const status = await saveVaultCredentials({
          exchange: "binance",
          apiKey: exchangeKey,
          apiSecret: exchangeSecret,
        });
        setCredentialStatus(status);
        setExchangeKey("");
        setExchangeSecret("");
      } catch (err) {
        setToast({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to store credentials in the server vault.",
        });
        return;
      }
    } else {
      await saveExchangeCredentials(selectedExchange, {
        apiKey: exchangeKey.trim(),
        apiSecret: exchangeSecret.trim(),
        passphrase: exchangePassphrase.trim() || undefined,
      });
    }

    // 2. Save Telegram Bot Configuration. The token is encrypted by the edge
    // function and never written to localStorage.
    const tgToken = telegramToken.trim();
    const tgChat = telegramChatId.trim();
    if (tgToken) {
      const tgResult = await saveTelegramCredentials({
        botToken: tgToken,
        chatId: tgChat,
        enabled: Boolean(tgToken && tgChat),
      });
      if (!tgResult.success) {
        setToast({
          type: "error",
          message: tgResult.error || "Failed to store Telegram credentials.",
        });
        return;
      }
      setTelegramTokenState("");
    } else if (tgChat !== loadTelegramConfig().chatId) {
      // Chat id changes only; the stored token stays server-side.
      saveTelegramConfig({ chatId: tgChat, enabled: Boolean(tgChat) });
    }

    setSaveSuccess(true);
    setToast({
      type: "success",
      message:
        selectedExchange === "binance"
          ? "Binance credentials encrypted server-side with AES-256-GCM and stored in your vault."
          : `${SUPPORTED_EXCHANGES.find((x) => x.id === selectedExchange)?.name} API credentials saved with AES-256-GCM.`,
    });
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleTestConnection = async () => {
    setTestingPing(true);
    setPingResult(null);
    const res = await testExchangeConnectivity(selectedExchange);
    setPingResult(res);
    setTestingPing(false);
  };

  const handleInstallClick = async () => {
    setInstallStatus("Prompting browser installation...");
    const outcome = await triggerInstall();
    if (outcome === "accepted") {
      setInstallStatus("PatternHunter AI installed successfully!");
    } else if (outcome === "dismissed") {
      setInstallStatus("Installation prompt dismissed.");
    } else {
      setInstallStatus(
        isStandalone
          ? "App is already installed and running in standalone mode."
          : "Installation available via your browser menu (Add to Home Screen / Install)."
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200 font-sans">
      <div className="relative w-full max-w-lg bg-[#090d16] border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-950/50 overflow-hidden flex flex-col max-h-[90vh] text-white">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-[#060910] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-950/50">
              <SettingsIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-wider uppercase font-mono">
                  System Settings & PWA Hub
                </h2>
                {isAdmin && (
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-500/20 text-[#00ff66] border border-emerald-500/40 flex items-center gap-1 font-mono">
                    <Crown className="w-3 h-3 text-[#00ff66]" /> ADMIN
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                PatternHunter AI v2.4 Enterprise Platform
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Toast Notification Banner */}
          {toast && (
            <div
              className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs font-mono animate-in fade-in slide-in-from-top-2 duration-200 ${
                toast.type === "success"
                  ? "bg-green-950/80 border-green-500/50 text-[#00ff66]"
                  : "bg-red-950/80 border-red-500/50 text-red-300"
              }`}
            >
              <div className="flex items-center gap-2">
                {toast.type === "success" ? (
                  <CheckCircle className="w-4 h-4 text-[#00ff66] shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                )}
                <span className="break-all">{toast.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Multi-Exchange API Configuration Section */}
          <div className="p-4 rounded-xl bg-[#0d121f] border border-cyan-500/30 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                <Key className="w-4 h-4 text-cyan-400" />
                Multi-Exchange Router (15+ Markets)
              </span>
              <span className="text-[10px] text-cyan-400 font-mono bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                AES-256-GCM · Server Vault
              </span>
            </div>

            {/* Exchange Tabs Selector */}
            <div className="grid grid-cols-4 gap-2">
              {SUPPORTED_EXCHANGES.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => setSelectedExchange(ex.id)}
                  className={`py-2 px-1 rounded-xl text-xs font-bold font-mono transition flex flex-col items-center gap-1 border ${
                    selectedExchange === ex.id
                      ? "bg-cyan-500/20 text-white border-cyan-400 shadow-md shadow-cyan-950/40"
                      : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white"
                  }`}
                >
                  <span className="text-sm font-black" style={{ color: ex.color }}>
                    {ex.iconText}
                  </span>
                  <span className="text-[10px]">{ex.name}</span>
                </button>
              ))}
            </div>

            <p className="text-[11px] text-slate-400 font-sans">
              {SUPPORTED_EXCHANGES.find((x) => x.id === selectedExchange)?.description}
            </p>

            {selectedExchange === "binance" && (
              <div
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border font-mono text-[11px] ${
                  credentialStatus.configured
                    ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                    : "bg-slate-950 border-slate-700 text-slate-400"
                }`}
              >
                <span>
                  {credentialStatus.configured
                    ? `✓ Encrypted credentials on server · ••••${credentialStatus.apiKeyLast4 ?? "----"}`
                    : "No Binance credentials stored yet (paper mode)"}
                </span>
                {credentialStatus.configured && (
                  <button
                    type="button"
                    onClick={handleDeleteStoredCredentials}
                    className="text-[10px] font-bold uppercase text-red-300 hover:text-red-200 border border-red-500/40 rounded px-2 py-1"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}

            <div className="space-y-3">
              {/* API Key */}
              <div>
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  {SUPPORTED_EXCHANGES.find((x) => x.id === selectedExchange)?.name} API Key
                </label>
                <div className="relative">
                  <input
                    type={showExchangeKey ? "text" : "password"}
                    value={exchangeKey}
                    onChange={(e) => setExchangeKey(e.target.value)}
                    placeholder={`Enter ${SUPPORTED_EXCHANGES.find((x) => x.id === selectedExchange)?.name} API Key`}
                    className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowExchangeKey(!showExchangeKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showExchangeKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Secret Key */}
              <div>
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  {SUPPORTED_EXCHANGES.find((x) => x.id === selectedExchange)?.name} Secret Key
                </label>
                <div className="relative">
                  <input
                    type={showExchangeSecret ? "text" : "password"}
                    value={exchangeSecret}
                    onChange={(e) => setExchangeSecret(e.target.value)}
                    placeholder={`Enter ${SUPPORTED_EXCHANGES.find((x) => x.id === selectedExchange)?.name} API Secret`}
                    className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowExchangeSecret(!showExchangeSecret)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showExchangeSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Passphrase (Required for OKX & KuCoin) */}
              {SUPPORTED_EXCHANGES.find((x) => x.id === selectedExchange)?.requiresPassphrase && (
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">
                    API Passphrase
                  </label>
                  <div className="relative">
                    <input
                      type={showPassphrase ? "text" : "password"}
                      value={exchangePassphrase}
                      onChange={(e) => setExchangePassphrase(e.target.value)}
                      placeholder="Passphrase specified when generating API key"
                      className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassphrase(!showPassphrase)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Test Ping & Connectivity Button */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testingPing}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-300 font-mono flex items-center gap-1.5"
                >
                  <Laptop className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{testingPing ? "Testing Ping..." : "Test Connection"}</span>
                </button>

                {pingResult && (
                  <span className={`text-xs font-mono font-bold ${pingResult.success ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
                    {pingResult.success ? `✓ Online (${pingResult.latencyMs}ms)` : `✗ Failed`}
                  </span>
                )}
              </div>

              {/* Telegram Bot Token */}
              <div className="pt-3 border-t border-slate-800">
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  Telegram Bot Token (Optional)
                </label>
                <div className="relative">
                  <input
                    type={showTelegramToken ? "text" : "password"}
                    value={telegramToken}
                    onChange={(e) => setTelegramTokenState(e.target.value)}
                    placeholder="Enter a bot token to store it encrypted (never saved in the browser)"
                    className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTelegramToken(!showTelegramToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showTelegramToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Telegram Chat ID */}
              <div>
                <label className="text-[11px] font-medium text-slate-300 block mb-1">
                  Telegram Chat ID (Optional)
                </label>
                <div className="relative">
                  <input
                    type={showTelegramChatId ? "text" : "password"}
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatIdState(e.target.value)}
                    placeholder="-100123456789 or User ID"
                    className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTelegramChatId(!showTelegramChatId)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showTelegramChatId ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Save API Configuration Button */}
              <button
                type="button"
                onClick={() => handleSaveApiConfiguration()}
                className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition shadow-md font-mono ${
                  saveSuccess
                    ? "bg-green-600 text-white shadow-green-950/40"
                    : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-950/40"
                }`}
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-4 h-4" />
                    Exchange Keys Saved Successfully!
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4" />
                    Save & Activate Exchange Keys
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Global AI Config — ADMIN ONLY (keys are shared by every signed-in user) */}
          {isAdmin && (
            <div className="p-4 rounded-xl bg-[#0d121f] border border-emerald-500/30 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                  <BrainCircuit className="w-4 h-4 text-emerald-400" />
                  Global AI Config
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-950/60 text-[#00ff66]">
                  ADMIN ONLY
                </span>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Shared provider keys used by every signed-in user. AI requests now go straight from the
                browser to the selected provider — the <span className="text-slate-300 font-mono">ai-chat</span>{" "}
                edge function is no longer involved.
              </p>

              {aiConfigLoading ? (
                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  Loading global AI configuration…
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-[11px] font-medium text-slate-300 block mb-1">
                      Active AI Provider
                    </label>
                    <select
                      value={aiConfig.activeProvider}
                      onChange={(e) => updateAiConfig({ activeProvider: e.target.value as AIProvider })}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-400 focus:outline-none text-xs text-white font-mono"
                    >
                      {AI_PROVIDER_IDS.map((provider) => (
                        <option key={provider} value={provider}>
                          {AI_PROVIDER_META[provider].label}
                          {AI_PROVIDER_META[provider].supportsVision ? " · Vision capable" : " · Text only"}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Configured keys:{" "}
                      {listConfiguredProviders(aiConfig).length > 0
                        ? listConfiguredProviders(aiConfig)
                            .map((p) => AI_PROVIDER_META[p].label)
                            .join(", ")
                        : "none yet"}
                      {" "}· Chat and Vision fall back to the next configured provider on failure · Vision always uses Gemini.
                    </p>
                  </div>

                  {AI_PROVIDER_IDS.map((provider) => {
                    const meta = AI_PROVIDER_META[provider];
                    const fields = PROVIDER_FIELDS[provider];
                    const isActive = aiConfig.activeProvider === provider;
                    return (
                      <div
                        key={provider}
                        className={`p-3 rounded-lg border space-y-2 ${
                          isActive
                            ? "bg-emerald-950/20 border-emerald-500/40"
                            : "bg-slate-950 border-slate-800"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-200 font-mono">{meta.label}</span>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                              isActive
                                ? "bg-emerald-500/20 text-[#00ff66] border-emerald-500/40"
                                : "bg-slate-800 text-slate-400 border-slate-700"
                            }`}
                          >
                            {isActive ? "ACTIVE" : meta.supportsVision ? "VISION" : "TEXT"}
                          </span>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-slate-300 block mb-1">
                            {meta.label} API Key
                          </label>
                          <div className="relative">
                            <input
                              type={visibleAiKeys[provider] ? "text" : "password"}
                              value={aiConfig[fields.key] as string}
                              onChange={(e) => setProviderField(provider, "key", e.target.value)}
                              placeholder={
                                isActive
                                  ? "Required for the active provider"
                                  : `${meta.label} API key (optional)`
                              }
                              autoComplete="off"
                              className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setVisibleAiKeys((prev) => ({ ...prev, [provider]: !prev[provider] }))
                              }
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                              title={visibleAiKeys[provider] ? "Hide API key" : "Show API key"}
                            >
                              {visibleAiKeys[provider] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] font-medium text-slate-300 block mb-1">
                            {meta.label} Model Name
                          </label>
                          <input
                            type="text"
                            value={aiConfig[fields.model] as string}
                            onChange={(e) => setProviderField(provider, "model", e.target.value)}
                            placeholder={meta.defaultModel}
                            autoComplete="off"
                            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-emerald-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                          />
                        </div>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={handleSaveGlobalAIConfig}
                    disabled={aiConfigSaving}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition shadow-md shadow-emerald-950/40 font-mono disabled:opacity-60"
                  >
                    {aiConfigSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving Global Config…
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Save Global AI Config
                      </>
                    )}
                  </button>

                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Stored in <span className="font-mono text-slate-400">global_settings</span> (id ={" "}
                    <span className="font-mono text-slate-400">global_config</span>) and readable by signed-in
                    clients, because the browser calls the providers directly. Only admins can write it.
                  </p>
                </>
              )}
            </div>
          )}

          {/* TradingView Webhook Integration Section (Bloomberg Terminal Aesthetic) */}
          <div className="p-4 rounded-xl bg-[#080d1a] border border-amber-500/40 shadow-lg shadow-amber-950/20 space-y-4 font-mono">
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
              <div className="flex items-center gap-2">
                <Webhook className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                  TradingView Webhook Integration
                </span>
              </div>
              <span className="text-[10px] text-amber-400/90 bg-amber-950/50 px-2 py-0.5 rounded border border-amber-500/30 font-bold">
                AUTO-EXECUTION
              </span>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed font-sans">
              Connect TradingView alerts to trigger instant trade execution. Paste this unique Webhook URL into your TradingView alert settings.
            </p>

            {/* Unique Webhook URL field */}
            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">
                Unique Webhook Endpoint URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={webhookUrl}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-xs text-amber-300 font-mono select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyWebhookUrl}
                  className="px-3 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1 transition"
                  title="Copy Webhook URL"
                >
                  {copiedUrl ? <Check className="w-4 h-4 text-[#00ff66]" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedUrl ? "Copied" : "Copy"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleRegenerateWebhookToken}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition"
                  title="Regenerate Secret Webhook Token"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Payload Template & Test Trigger */}
            <div className="pt-2 border-t border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-300">
                  TradingView Alert Message (JSON Body):
                </span>
                <button
                  type="button"
                  onClick={handleCopySamplePayload}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-bold"
                >
                  {copiedPayload ? <Check className="w-3 h-3 text-[#00ff66]" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedPayload ? "Copied Payload" : "Copy Payload"}</span>
                </button>
              </div>

              <pre className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-emerald-400 overflow-x-auto leading-relaxed">
                {webhookService.getSampleJsonPayload(testSymbol, testAction.toLowerCase() as "buy" | "sell")}
              </pre>

              {/* Simulation test bar */}
              <div className="flex items-center gap-2 pt-1">
                <select
                  value={testAction}
                  onChange={(e) => setTestAction(e.target.value as "BUY" | "SELL")}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-bold text-white focus:outline-none"
                >
                  <option value="BUY">BUY / LONG</option>
                  <option value="SELL">SELL / SHORT</option>
                </select>

                <input
                  type="text"
                  value={testSymbol}
                  onChange={(e) => setTestSymbol(e.target.value.toUpperCase())}
                  placeholder="BTCUSDT"
                  className="w-24 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-bold text-white uppercase focus:outline-none"
                />

                <button
                  type="button"
                  onClick={handleSimulateWebhook}
                  className="flex-1 py-1.5 px-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5 transition"
                >
                  <Play className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                  <span>Test Signal Trigger</span>
                </button>
              </div>
            </div>
          </div>

          {/* PWA Installation Card */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-950/40 via-slate-900/60 to-blue-950/30 border border-cyan-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Progressive Web App (PWA)
                </span>
              </div>
              {isStandalone ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-[#00ff66] border border-green-500/40 flex items-center gap-1 font-mono">
                  <CheckCircle className="w-3 h-3" /> STANDALONE ACTIVE
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono">
                  READY TO INSTALL
                </span>
              )}
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Install PatternHunter AI directly on your Desktop, iOS, or Android device for zero-latency charting, fullscreen view, offline caching, and instant native alerts.
            </p>

            <button
              onClick={handleInstallClick}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition shadow-lg shadow-cyan-950/40 font-mono"
            >
              <Download className="w-4 h-4" />
              {isStandalone ? "App Already Installed" : "Install App"}
            </button>

            {installStatus && (
              <p className="text-[11px] text-cyan-300 text-center font-mono pt-1">
                {installStatus}
              </p>
            )}
          </div>

          {/* Quick AI & Terminal Access */}
          <div className="p-4 rounded-xl bg-[#0d121f] border border-slate-800 space-y-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 font-mono">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Advanced AI & Engine Access
            </span>

            <div className="grid grid-cols-2 gap-2 text-xs">
              {onOpenVisionAI && (
                <button
                  onClick={() => {
                    onClose();
                    onOpenVisionAI();
                  }}
                  className="p-3 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition"
                >
                  <span className="font-bold text-cyan-400 block mb-0.5">Vision AI Upload</span>
                  <span className="text-[10px] text-slate-500 block">Analyze chart screenshots</span>
                </button>
              )}

              {onOpenAutoTrade && (
                <button
                  onClick={() => {
                    onClose();
                    onOpenAutoTrade();
                  }}
                  className="p-3 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition"
                >
                  <span className="font-bold text-amber-400 block mb-0.5">Auto-Trade Engine</span>
                  <span className="text-[10px] text-slate-500 block">Configure execution rules</span>
                </button>
              )}
            </div>
          </div>

          {/* Preferences */}
          <div className="p-4 rounded-xl bg-[#0d121f] border border-slate-800 space-y-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 font-mono">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              Application Preferences
            </span>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-cyan-400" />
                    <div>
                      <span className="text-slate-200 font-bold block">PWA Push Notifications</span>
                      <span className="text-[10px] text-slate-400">Background trade execution & pattern alerts</span>
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-bold ${
                    pushPermission === "granted"
                      ? "bg-emerald-500/20 text-[#00ff66] border-emerald-500/40"
                      : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  }`}>
                    {pushPermission === "granted" ? "ACTIVE" : pushPermission.toUpperCase()}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  {pushPermission !== "granted" ? (
                    <button
                      type="button"
                      onClick={handleRequestPushPermission}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition"
                    >
                      Enable Push Notifications
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSendTestPush}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold text-xs flex items-center justify-center gap-1.5 transition font-mono"
                    >
                      <Bell className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Send Test Push Notification</span>
                    </button>
                  )}
                </div>
              </div>

              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2">
                  <Laptop className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-300">Audio Confirmations</span>
                </div>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => setSoundEnabled(e.target.checked)}
                  className="w-4 h-4 accent-cyan-500"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-300">Haptic Feedback on Trades</span>
                </div>
                <input
                  type="checkbox"
                  checked={hapticFeedback}
                  onChange={(e) => setHapticFeedback(e.target.checked)}
                  className="w-4 h-4 accent-cyan-500"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[#060910] border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span className="font-mono text-[11px]">Theme Color: #0F172A (Deep Slate)</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
