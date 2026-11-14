import { useEffect, useState } from "react";
import { X, Zap } from "lucide-react";

export interface ScannerExecutionSettings {
  leverage: number;
  riskPercent: number;
  marginType: "Isolated" | "Cross";
  sizingMode: "Risk-Based" | "Fixed USD";
  fixedUsdAmount: number;
  slippageTolerance: number;
  confirmBeforeTrade: boolean;
  soundOnExecution: boolean;
}

export const DEFAULT_SCANNER_EXECUTION_SETTINGS: ScannerExecutionSettings = {
  leverage: 5,
  riskPercent: 1.5,
  marginType: "Isolated",
  sizingMode: "Risk-Based",
  fixedUsdAmount: 100,
  slippageTolerance: 0.2,
  confirmBeforeTrade: true,
  soundOnExecution: true,
};

const STORAGE_KEY = "scanner_execution_settings";

export function loadScannerExecutionSettings(): ScannerExecutionSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SCANNER_EXECUTION_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<ScannerExecutionSettings>;
    return {
      leverage: clamp(parsed.leverage ?? DEFAULT_SCANNER_EXECUTION_SETTINGS.leverage, 1, 20),
      riskPercent: clamp(parsed.riskPercent ?? DEFAULT_SCANNER_EXECUTION_SETTINGS.riskPercent, 0.5, 5),
      marginType: parsed.marginType === "Cross" ? "Cross" : "Isolated",
      sizingMode: parsed.sizingMode === "Fixed USD" ? "Fixed USD" : "Risk-Based",
      fixedUsdAmount: clamp(parsed.fixedUsdAmount ?? 100, 10, 100000),
      slippageTolerance: clamp(parsed.slippageTolerance ?? 0.2, 0, 5),
      confirmBeforeTrade: parsed.confirmBeforeTrade !== false,
      soundOnExecution: parsed.soundOnExecution !== false,
    };
  } catch {
    return { ...DEFAULT_SCANNER_EXECUTION_SETTINGS };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ScannerTradeSettings({ open, onClose }: Props) {
  const [settings, setSettings] = useState<ScannerExecutionSettings>(() => loadScannerExecutionSettings());

  useEffect(() => {
    if (!open) return;
    setSettings(loadScannerExecutionSettings());
  }, [open]);

  const update = <K extends keyof ScannerExecutionSettings>(key: K, value: ScannerExecutionSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            Trade Execution Settings
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <label className="block">
            <span className="text-slate-400">Leverage</span>
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={settings.leverage}
              onChange={(e) => update("leverage", clamp(Number(e.target.value), 1, 20))}
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-slate-200"
            />
          </label>

          <label className="block">
            <span className="text-slate-400">Risk Per Trade (%)</span>
            <input
              type="number"
              min={0.5}
              max={5}
              step={0.1}
              value={settings.riskPercent}
              onChange={(e) => update("riskPercent", clamp(Number(e.target.value), 0.5, 5))}
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-slate-200"
            />
          </label>

          <label className="block">
            <span className="text-slate-400">Margin Type</span>
            <select
              value={settings.marginType}
              onChange={(e) => update("marginType", e.target.value as "Isolated" | "Cross")}
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-slate-200"
            >
              <option value="Isolated">Isolated</option>
              <option value="Cross">Cross</option>
            </select>
          </label>

          <label className="block">
            <span className="text-slate-400">Position Sizing Mode</span>
            <select
              value={settings.sizingMode}
              onChange={(e) => update("sizingMode", e.target.value as "Risk-Based" | "Fixed USD")}
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-slate-200"
            >
              <option value="Risk-Based">Risk-Based</option>
              <option value="Fixed USD">Fixed USD Amount</option>
            </select>
          </label>

          {settings.sizingMode === "Fixed USD" && (
            <label className="block">
              <span className="text-slate-400">Fixed USD Amount</span>
              <input
                type="number"
                min={10}
                step={10}
                value={settings.fixedUsdAmount}
                onChange={(e) => update("fixedUsdAmount", clamp(Number(e.target.value), 10, 100000))}
                className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-slate-200"
              />
            </label>
          )}

          <label className="block">
            <span className="text-slate-400">Slippage Tolerance (%)</span>
            <input
              type="number"
              min={0}
              max={5}
              step={0.1}
              value={settings.slippageTolerance}
              onChange={(e) => update("slippageTolerance", clamp(Number(e.target.value), 0, 5))}
              className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-slate-200"
            />
          </label>

          <label className="flex items-center justify-between">
            <span className="text-slate-300">Confirm Before Trade</span>
            <input
              type="checkbox"
              checked={settings.confirmBeforeTrade}
              onChange={(e) => update("confirmBeforeTrade", e.target.checked)}
              className="w-4 h-4"
            />
          </label>

          <label className="flex items-center justify-between">
            <span className="text-slate-300">Sound on Execution</span>
            <input
              type="checkbox"
              checked={settings.soundOnExecution}
              onChange={(e) => update("soundOnExecution", e.target.checked)}
              className="w-4 h-4"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300">
            Cancel
          </button>
          <button onClick={save} className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-xs font-bold text-slate-950">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}