import { Keyboard } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: "1 — 5", desc: "Switch tabs (Chart, Scanner, Watchlist, History, Alerts)" },
  { keys: "6 — 0", desc: "More tabs (Depth, Trades, Heatmap, Confluence, Backtest)" },
  { keys: "R", desc: "Refresh chart data" },
  { keys: "?", desc: "Toggle this help overlay" },
  { keys: "Esc", desc: "Close dialogs and overlays" },
];

export default function KeyboardHelp({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
          <Keyboard className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-bold text-white">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="ml-auto text-slate-400 hover:text-white text-xs transition-colors"
          >
            Close
          </button>
        </div>
        <div className="p-5 space-y-3">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center gap-4">
              <kbd className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-mono font-medium text-cyan-400 min-w-[60px] text-center shrink-0">
                {s.keys}
              </kbd>
              <span className="text-sm text-slate-300">{s.desc}</span>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-slate-800">
          <p className="text-xs text-slate-500 text-center">
            Shortcuts are disabled while typing in input fields.
          </p>
        </div>
      </div>
    </div>
  );
}
