import {
  X,
  TrendingUp,
  SlidersHorizontal,
  Bookmark,
  Bell,
  MessageSquare,
  History,
  Grid,
  Bot,
  Layers,
  ArrowRightLeft,
  Compass,
} from "lucide-react";
import type { AppTab } from "../types";

interface SideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
}

export function SideDrawer({ isOpen, onClose, activeTab, onSelectTab }: SideDrawerProps) {
  if (!isOpen) return null;

  const menuSections = [
    {
      title: "Trading & Execution",
      items: [
        { id: "chart" as AppTab, label: "Chart Analysis", icon: TrendingUp },
        { id: "positions" as AppTab, label: "Active Positions & Ledger", icon: Layers },
      ],
    },
    {
      title: "Quantitative Tools",
      items: [
        { id: "arbitrage" as AppTab, label: "Cross-DEX Arbitrage", icon: ArrowRightLeft },
        { id: "backtest" as AppTab, label: "Backtest Lab", icon: SlidersHorizontal },
        { id: "grid" as AppTab, label: "Grid Bot Engine", icon: Grid },
        { id: "dca" as AppTab, label: "DCA Bot Engine", icon: SlidersHorizontal },
        { id: "strategy" as AppTab, label: "Strategy Builder", icon: Compass },
        { id: "copy" as AppTab, label: "Strategy Marketplace & Copy", icon: Bot },
      ],
    },
    {
      title: "Market Intelligence",
      items: [
        { id: "watchlist" as AppTab, label: "Asset Watchlist", icon: Bookmark },
        { id: "alerts" as AppTab, label: "Price & Confluence Alerts", icon: Bell },
        { id: "chat" as AppTab, label: "AI Trading Agent Chat", icon: MessageSquare },
        { id: "history" as AppTab, label: "Trade Execution History", icon: History },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 left-0 max-w-full flex">
        <div className="w-screen max-w-xs sm:max-w-sm bg-[#0c1017] border-r border-slate-800 flex flex-col shadow-2xl relative z-10 animate-in slide-in-from-left duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-[#0f141f]">
            <div className="flex items-center space-x-2.5">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-black text-sm">
                PH
              </div>
              <div>
                <h2 className="text-sm font-bold text-white tracking-wide">PatternHunter AI</h2>
                <p className="text-[10px] text-slate-400">Fortress Terminal Navigation</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Menu Items */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
            {menuSections.map((section) => (
              <div key={section.title}>
                <h3 className="px-2 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.title}
                </h3>
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          onSelectTab(item.id);
                          onClose();
                        }}
                        className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                          isActive
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            : "text-slate-300 hover:text-white hover:bg-slate-800/60"
                        }`}
                      >
                        <Icon className={`h-4 w-4 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-800 bg-[#0a0d14] text-[11px] text-slate-400 flex items-center justify-between">
            <span>Terminal v2.5.0 Pro</span>
            <span className="text-emerald-400 font-mono text-[10px]">Connected • 18ms</span>
          </div>
        </div>
      </div>
    </div>
  );
}
