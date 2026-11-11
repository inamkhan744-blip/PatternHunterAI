import { useState } from "react";
import { Trophy, Medal, Share2, TrendingUp, CheckCircle2, Shield, Copy, Twitter, X, Flame } from "lucide-react";

interface RankedTrader {
  rank: number;
  handle: string;
  avatarText: string;
  badge: "Master" | "Elite" | "Pro";
  roi30d: number;
  winRate: number;
  totalProfit: number;
  maxDrawdown: number;
  strategy: string;
}

const MOCK_LEADERBOARD_TRADERS: RankedTrader[] = [
  {
    rank: 1,
    handle: "QuantWhale_88",
    avatarText: "QW",
    badge: "Master",
    roi30d: 142.8,
    winRate: 84.5,
    totalProfit: 84210,
    maxDrawdown: 4.8,
    strategy: "SMC Liquidity & FVG Scalp",
  },
  {
    rank: 2,
    handle: "Apex_Flow",
    avatarText: "AF",
    badge: "Master",
    roi30d: 118.4,
    winRate: 79.2,
    totalProfit: 62500,
    maxDrawdown: 6.2,
    strategy: "Multi-Timeframe Trend Surfer",
  },
  {
    rank: 3,
    handle: "ArbitrageKing",
    avatarText: "AK",
    badge: "Elite",
    roi30d: 94.6,
    winRate: 91.0,
    totalProfit: 48900,
    maxDrawdown: 1.8,
    strategy: "Delta-Neutral Funding Harvest",
  },
  {
    rank: 4,
    handle: "SatoshiGhost",
    avatarText: "SG",
    badge: "Elite",
    roi30d: 87.2,
    winRate: 76.8,
    totalProfit: 39400,
    maxDrawdown: 7.5,
    strategy: "Institutional Order Block Swarm",
  },
  {
    rank: 5,
    handle: "HyperLiquid_AI",
    avatarText: "HL",
    badge: "Pro",
    roi30d: 72.5,
    winRate: 73.4,
    totalProfit: 31200,
    maxDrawdown: 5.1,
    strategy: "Grid & Dynamic Trailing DCA",
  },
];

interface LeaderboardModalProps {
  open: boolean;
  onClose: () => void;
}

export default function LeaderboardModal({ open, onClose }: LeaderboardModalProps) {
  const [selectedTrader, setSelectedTrader] = useState<RankedTrader | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  if (!open) return null;

  const handleSharePnL = (trader: RankedTrader) => {
    setSelectedTrader(trader);
  };

  const handleCopyShareLink = () => {
    navigator.clipboard?.writeText(window.location.origin);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-gradient-to-r from-amber-500/10 via-slate-900 to-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white uppercase tracking-wider">Verified Trader Leaderboard</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  TOP 30D ROI
                </span>
              </div>
              <p className="text-xs text-slate-400">Audited algorithmic performances across live and paper accounts</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {selectedTrader && (
            <div className="p-4 rounded-xl bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 border border-amber-500/50 shadow-xl mb-4 relative overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Flame className="w-5 h-5 text-amber-400" />
                  <span className="text-xs font-black uppercase text-amber-400 tracking-wider">Verified PnL Card</span>
                </div>
                <button
                  onClick={() => setSelectedTrader(null)}
                  className="text-slate-400 hover:text-white text-xs font-semibold"
                >
                  Close Card
                </button>
              </div>

              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-900 font-black text-base shadow-md">
                  {selectedTrader.avatarText}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-base font-bold text-white font-mono">{selectedTrader.handle}</h3>
                    <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                  </div>
                  <p className="text-xs text-slate-400">{selectedTrader.strategy}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 p-3 bg-slate-950/80 rounded-lg border border-slate-800 text-center mb-3">
                <div>
                  <span className="text-[10px] text-slate-500 block">30D ROI</span>
                  <span className="text-base font-mono font-bold text-[#00ff66]">+{selectedTrader.roi30d}%</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Win Rate</span>
                  <span className="text-base font-mono font-bold text-white">{selectedTrader.winRate}%</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Total Profit</span>
                  <span className="text-base font-mono font-bold text-cyan-400">+${selectedTrader.totalProfit.toLocaleString()}</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                <span className="font-mono text-[10px]">Verified via PatternHunter AI Execution Layer</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyShareLink}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold transition"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedLink ? "Link Copied!" : "Copy Link"}</span>
                  </button>
                  <button
                    onClick={() => {
                      const tweet = `Check out my audited +${selectedTrader.roi30d}% 30-day ROI on PatternHunter AI! 🚀`;
                      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, "_blank");
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-900 font-bold transition"
                  >
                    <Twitter className="w-3.5 h-3.5" />
                    <span>Share on X</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {MOCK_LEADERBOARD_TRADERS.map((t) => (
              <div
                key={t.handle}
                className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 hover:border-slate-700 transition flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs ${
                    t.rank === 1 ? "bg-amber-400/20 text-amber-400 border border-amber-400/40" :
                    t.rank === 2 ? "bg-slate-300/20 text-slate-200 border border-slate-300/40" :
                    t.rank === 3 ? "bg-amber-700/20 text-amber-600 border border-amber-700/40" :
                    "bg-slate-800 text-slate-400"
                  }`}>
                    {t.rank}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white text-sm">{t.handle}</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                        {t.badge}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500">{t.strategy}</span>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">30D ROI</span>
                    <span className="font-mono font-bold text-[#00ff66] text-sm">+{t.roi30d}%</span>
                  </div>
                  <div className="text-right hidden sm:block">
                    <span className="text-[10px] text-slate-500 block">Win Rate</span>
                    <span className="font-mono font-bold text-slate-200">{t.winRate}%</span>
                  </div>
                  <div className="text-right hidden sm:block">
                    <span className="text-[10px] text-slate-500 block">Profit</span>
                    <span className="font-mono font-bold text-cyan-400">+${t.totalProfit.toLocaleString()}</span>
                  </div>
                  <button
                    onClick={() => handleSharePnL(t)}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                    title="Generate Shareable PnL Card"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs">
          <span className="text-slate-500 font-mono text-[10px]">Rankings updated hourly via cryptographic proof-of-trade</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
