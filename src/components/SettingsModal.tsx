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
  RefreshCw,
  Send,
  Check,
  AlertCircle,
  Cpu,
  Lock,
  Crown,
} from "lucide-react";
import { usePWAInstall } from "../lib/pwa";
import {
  getGeminiApiKey,
  setGeminiApiKey,
  getSelectedModel,
  setSelectedModel,
  getCachedModels,
  fetchAvailableModels,
  testModel,
} from "../lib/ModelManager";
import { getDecryptedApiKeys, storeEncryptedApiKeys } from "../lib/CryptoSecurity";
import { loadTelegramConfig, saveTelegramConfig } from "../lib/TelegramService";
import { autoTradeEngine } from "../lib/BinanceAutoTrade";
import { useAuth } from "../lib/auth";
import { isUserAdmin } from "../lib/SubscriptionManager";

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

export default function SettingsModal({
  open,
  onClose,
  isAdmin: propIsAdmin,
  onOpenAutoTrade,
  onOpenVisionAI,
}: Props) {
  const { user } = useAuth();
  const isAdmin = propIsAdmin ?? isUserAdmin(user?.email);

  const { isStandalone, triggerInstall } = usePWAInstall();
  const [installStatus, setInstallStatus] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticFeedback, setHapticFeedback] = useState(true);

  // API Key Form State
  const [geminiKey, setGeminiKeyState] = useState<string>("");
  const [binanceKey, setBinanceKeyState] = useState<string>("");
  const [binanceSecret, setBinanceSecretState] = useState<string>("");
  const [telegramToken, setTelegramTokenState] = useState<string>("");
  const [telegramChatId, setTelegramChatIdState] = useState<string>("");

  // Show / Hide Password field states
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showBinanceKey, setShowBinanceKey] = useState(false);
  const [showBinanceSecret, setShowBinanceSecret] = useState(false);
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [showTelegramChatId, setShowTelegramChatId] = useState(false);

  // Dynamic Models State
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [currentModel, setCurrentModelState] = useState<string>("gemini-2.0-flash");
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testingModel, setTestingModel] = useState(false);

  // Toast Notification State
  const [toast, setToast] = useState<ToastState | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load stored credentials and models when opening modal
  useEffect(() => {
    if (!open) return;
    setGeminiKeyState(getGeminiApiKey());
    const binanceKeys = getDecryptedApiKeys();
    setBinanceKeyState(binanceKeys.apiKey || "");
    setBinanceSecretState(binanceKeys.apiSecret || "");

    const tg = loadTelegramConfig();
    setTelegramTokenState(tg.botToken || "");
    setTelegramChatIdState(tg.chatId || "");

    setAvailableModels(getCachedModels());
    setCurrentModelState(getSelectedModel());
    setToast(null);
    setSaveSuccess(false);
  }, [open]);

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!open) return null;

  const handleFetchModels = async () => {
    if (!isAdmin) return;
    if (!geminiKey.trim()) {
      setToast({
        type: "error",
        message: "Please enter your Gemini API Key before fetching models.",
      });
      return;
    }

    setFetchingModels(true);
    setToast(null);
    try {
      setGeminiApiKey(geminiKey.trim());
      const models = await fetchAvailableModels(geminiKey.trim());
      setAvailableModels(models);

      if (models.length > 0) {
        if (!models.includes(currentModel)) {
          setCurrentModelState(models[0]);
          setSelectedModel(models[0]);
        }
        setToast({
          type: "success",
          message: `Successfully fetched ${models.length} Gemini models!`,
        });
      } else {
        setToast({
          type: "error",
          message: "No compatible generateContent models found for this API Key.",
        });
      }
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to fetch Gemini models",
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestSelectedModel = async () => {
    if (!isAdmin) return;
    if (!geminiKey.trim()) {
      setToast({
        type: "error",
        message: "API Key Invalid: Please provide a Gemini API Key.",
      });
      return;
    }

    setTestingModel(true);
    setToast(null);
    try {
      setGeminiApiKey(geminiKey.trim());
      setSelectedModel(currentModel);
      const res = await testModel(geminiKey.trim(), currentModel);
      if (res.success) {
        setToast({
          type: "success",
          message: "Model is working!",
        });
      } else {
        setToast({
          type: "error",
          message: res.message || "Model test failed.",
        });
      }
    } catch (err) {
      setToast({
        type: "error",
        message: err instanceof Error ? err.message : "Model test request failed.",
      });
    } finally {
      setTestingModel(false);
    }
  };

  const handleSaveApiConfiguration = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isAdmin) return;

    // 1. Save Gemini API Key
    setGeminiApiKey(geminiKey.trim());

    // 2. Save Selected Gemini Model
    setSelectedModel(currentModel);

    // 3. Encrypt and Save Binance API Keys
    storeEncryptedApiKeys(binanceKey.trim(), binanceSecret.trim());
    autoTradeEngine.saveConfig({
      apiKey: binanceKey.trim(),
      apiSecret: binanceSecret.trim(),
    });

    // 4. Save Telegram Bot Configuration
    saveTelegramConfig({
      botToken: telegramToken.trim(),
      chatId: telegramChatId.trim(),
      enabled: Boolean(telegramToken.trim() && telegramChatId.trim()),
    });

    setSaveSuccess(true);
    setToast({
      type: "success",
      message: "API Configuration saved securely to localStorage!",
    });
    setTimeout(() => setSaveSuccess(false), 3000);
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

          {/* API Configuration Section */}
          <div className="p-4 rounded-xl bg-[#0d121f] border border-cyan-500/30 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                <Key className="w-4 h-4 text-cyan-400" />
                API Configuration
              </span>
              <span className="text-[10px] text-cyan-400 font-mono bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                {isAdmin ? "Admin Unlocked" : "Admin Managed"}
              </span>
            </div>

            {/* Check isAdmin: Only Admin can view and edit API Key input fields */}
            {!isAdmin ? (
              <div className="p-5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center gap-3.5 text-slate-300">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <Lock className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                    Security Clearance Required
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    API Keys are managed by the Admin.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Gemini API Key */}
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">
                    Gemini API Key
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showGeminiKey ? "text" : "password"}
                        value={geminiKey}
                        onChange={(e) => setGeminiKeyState(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGeminiKey(!showGeminiKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        title={showGeminiKey ? "Hide Key" : "Show Key"}
                      >
                        {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={handleFetchModels}
                      disabled={fetchingModels || !geminiKey.trim()}
                      className="px-3 py-2 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/50 text-cyan-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-40 whitespace-nowrap"
                    >
                      {fetchingModels ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          Fetching...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" />
                          Fetch Models
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Dynamic Model Dropdown & Test Model */}
                {availableModels.length > 0 && (
                  <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5 font-mono">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                        Gemini Model
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {availableModels.length} models available
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={currentModel}
                        onChange={(e) => {
                          setCurrentModelState(e.target.value);
                          setSelectedModel(e.target.value);
                        }}
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:border-cyan-400 focus:outline-none font-mono"
                      >
                        {availableModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={handleTestSelectedModel}
                        disabled={testingModel || !geminiKey.trim()}
                        className="px-3 py-2 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/50 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-40 whitespace-nowrap font-mono"
                      >
                        {testingModel ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                            Testing...
                          </>
                        ) : (
                          <>
                            <Send className="w-3.5 h-3.5 text-emerald-400" />
                            Test Model
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Binance API Key */}
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">
                    Binance API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showBinanceKey ? "text" : "password"}
                      value={binanceKey}
                      onChange={(e) => setBinanceKeyState(e.target.value)}
                      placeholder="Enter Binance Spot / Futures API Key"
                      className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBinanceKey(!showBinanceKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      title={showBinanceKey ? "Hide Key" : "Show Key"}
                    >
                      {showBinanceKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Binance Secret Key */}
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">
                    Binance Secret Key
                  </label>
                  <div className="relative">
                    <input
                      type={showBinanceSecret ? "text" : "password"}
                      value={binanceSecret}
                      onChange={(e) => setBinanceSecretState(e.target.value)}
                      placeholder="Enter Binance API Secret"
                      className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBinanceSecret(!showBinanceSecret)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      title={showBinanceSecret ? "Hide Secret" : "Show Secret"}
                    >
                      {showBinanceSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Telegram Bot Token */}
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">
                    Telegram Bot Token
                  </label>
                  <div className="relative">
                    <input
                      type={showTelegramToken ? "text" : "password"}
                      value={telegramToken}
                      onChange={(e) => setTelegramTokenState(e.target.value)}
                      placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                      className="w-full px-3 py-2 pr-9 rounded-lg bg-slate-950 border border-slate-700 focus:border-cyan-400 focus:outline-none text-xs text-white placeholder-slate-600 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTelegramToken(!showTelegramToken)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      title={showTelegramToken ? "Hide Token" : "Show Token"}
                    >
                      {showTelegramToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Telegram Chat ID */}
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">
                    Telegram Chat ID
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
                      title={showTelegramChatId ? "Hide Chat ID" : "Show Chat ID"}
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
                      Keys Saved Successfully!
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4" />
                      Save API Configuration
                    </>
                  )}
                </button>
              </div>
            )}
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
              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-2">
                  <Bell className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-300">Push Notifications & Alerts</span>
                </div>
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) => setNotificationsEnabled(e.target.checked)}
                  className="w-4 h-4 accent-cyan-500"
                />
              </label>

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
