import { useState, useEffect } from "react";
import {
  Users,
  TrendingUp,
  CheckCircle2,
  UserCheck,
  Zap,
  Store,
  Upload,
} from "lucide-react";
import { paperTradingEngine } from "../lib/PaperTrading";

export interface TopTrader {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  tier: "MASTER" | "PRO" | "ELITE";
  roi30d: number;
  winRate: number;
  totalTrades: number;
  aum: string;
  followers: number;
  riskScore: number; // 1 to 10
  maxDrawdown: number;
  strategy: string;
  recentPositions: {
    symbol: string;
    direction: "LONG" | "SHORT";
    leverage: number;
    pnlPct: number;
  }[];
}

export interface MarketplaceStrategy {
  id: string;
  title: string;
  author: string;
  authorHandle: string;
  authorAvatar: string;
  category: "SCALPING" | "SWING" | "ARBITRAGE" | "SMC" | "GRID";
  backtestedWinRate: number;
  roi30d: number;
  sharpeRatio: number;
  subscribers: number;
  priceModel: "FREE" | "PRO_EXCLUSIVE" | "$29/mo" | "$49/mo";
  description: string;
  keyIndicators: string[];
  maxLeverage: number;
}

const TOP_TRADERS: TopTrader[] = [
  {
    id: "trader-1",
    name: "Alex V.",
    handle: "@SatoshiSniper",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
    tier: "MASTER",
    roi30d: 148.6,
    winRate: 82.4,
    totalTrades: 342,
    aum: "$1.84M",
    followers: 4892,
    riskScore: 4,
    maxDrawdown: 8.2,
    strategy: "SMC Liquidity & Fair Value Gaps",
    recentPositions: [
      { symbol: "BTCUSDT", direction: "LONG", leverage: 5, pnlPct: 14.2 },
      { symbol: "ETHUSDT", direction: "SHORT", leverage: 3, pnlPct: 6.8 },
      { symbol: "SOLUSDT", direction: "LONG", leverage: 5, pnlPct: 22.4 },
    ],
  },
  {
    id: "trader-2",
    name: "Elena Rostova",
    handle: "@MacroWhale",
    avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
    tier: "MASTER",
    roi30d: 94.2,
    winRate: 78.9,
    totalTrades: 189,
    aum: "$3.42M",
    followers: 6120,
    riskScore: 3,
    maxDrawdown: 5.4,
    strategy: "Order Flow Delta & HTF Swings",
    recentPositions: [
      { symbol: "BTCUSDT", direction: "LONG", leverage: 2, pnlPct: 8.1 },
      { symbol: "BNBUSDT", direction: "LONG", leverage: 3, pnlPct: 12.3 },
    ],
  },
  {
    id: "trader-3",
    name: "Marcus Thorne",
    handle: "@DeltaNeutral",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
    tier: "ELITE",
    roi30d: 68.5,
    winRate: 88.6,
    totalTrades: 512,
    aum: "$920K",
    followers: 2410,
    riskScore: 2,
    maxDrawdown: 3.1,
    strategy: "Funding Rate & Spot-Futures Arbitrage",
    recentPositions: [
      { symbol: "DOGEUSDT", direction: "SHORT", leverage: 2, pnlPct: 4.2 },
      { symbol: "BTCUSDT", direction: "LONG", leverage: 2, pnlPct: 5.6 },
    ],
  },
  {
    id: "trader-4",
    name: "Kenji Sato",
    handle: "@AlphaPredator",
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
    tier: "PRO",
    roi30d: 112.3,
    winRate: 74.2,
    totalTrades: 278,
    aum: "$680K",
    followers: 1850,
    riskScore: 6,
    maxDrawdown: 12.8,
    strategy: "High-Beta Breakouts & Momentum",
    recentPositions: [
      { symbol: "AVAXUSDT", direction: "LONG", leverage: 5, pnlPct: 18.5 },
      { symbol: "NEARUSDT", direction: "LONG", leverage: 4, pnlPct: 11.2 },
    ],
  },
];

const DEFAULT_MARKETPLACE_STRATEGIES: MarketplaceStrategy[] = [
  {
    id: "strat-1",
    title: "SMC Institutional Liquidity Sweep",
    author: "Alex V.",
    authorHandle: "@SatoshiSniper",
    authorAvatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
    category: "SMC",
    backtestedWinRate: 84.2,
    roi30d: 132.4,
    sharpeRatio: 2.85,
    subscribers: 1240,
    priceModel: "PRO_EXCLUSIVE",
    description: "Detects HTF Fair Value Gaps (FVG) and false breakout sweeps before entering with institutional orders.",
    keyIndicators: ["FVG", "Order Blocks", "RSI Divergence", "ATR 14"],
    maxLeverage: 5,
  },
  {
    id: "strat-2",
    title: "Delta Neutral Funding Rate Harvester",
    author: "Marcus Thorne",
    authorHandle: "@DeltaNeutral",
    authorAvatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
    category: "ARBITRAGE",
    backtestedWinRate: 91.0,
    roi30d: 46.8,
    sharpeRatio: 3.42,
    subscribers: 2890,
    priceModel: "FREE",
    description: "Captures 8-hour perpetual funding premiums with near-zero directional market risk.",
    keyIndicators: ["Funding Rate Spread", "Basis Delta", "Spot/Perp Imbalance"],
    maxLeverage: 2,
  },
  {
    id: "strat-3",
    title: "Whale Shadow Volatility Grid Rider",
    author: "Elena Rostova",
    authorHandle: "@MacroWhale",
    authorAvatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
    category: "GRID",
    backtestedWinRate: 88.5,
    roi30d: 78.2,
    sharpeRatio: 2.64,
    subscribers: 980,
    priceModel: "$29/mo",
    description: "Arithmetic micro-grid placing counter limit orders between dynamic whale support and resistance walls.",
    keyIndicators: ["L2 Depth Cumulative", "Bollinger Bands 20,2", "ATR Spacing"],
    maxLeverage: 3,
  },
  {
    id: "strat-4",
    title: "Multi-Timeframe Trend Crossover Hunter",
    author: "Kenji Sato",
    authorHandle: "@AlphaPredator",
    authorAvatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
    category: "SWING",
    backtestedWinRate: 76.8,
    roi30d: 95.1,
    sharpeRatio: 2.12,
    subscribers: 640,
    priceModel: "FREE",
    description: "EMA 20/50/200 cascade alignment paired with high-volume breakouts on top 20 altcoins.",
    keyIndicators: ["EMA Triple Ribbon", "MACD Histogram", "OBV"],
    maxLeverage: 4,
  },
];

const STORAGE_KEY_COPIED_TRADERS = "fortress_copied_traders_list";
const STORAGE_KEY_SUBSCRIBED_STRATEGIES = "fortress_subscribed_strategies_list";

interface CopiedConfig {
  traderId: string;
  allocationUsd: number;
  maxLeverage: number;
  stopLossLimitPct: number;
  copiedAt: number;
  simulatedProfit: number;
}

export default function CopyTradingTab() {
  const [activeSubTab, setActiveSubTab] = useState<"traders" | "marketplace">("marketplace");

  const [copiedMap, setCopiedMap] = useState<Record<string, CopiedConfig>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_COPIED_TRADERS);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const [subscribedStrategies, setSubscribedStrategies] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SUBSCRIBED_STRATEGIES);
      return stored ? JSON.parse(stored) : ["strat-2"];
    } catch {
      return ["strat-2"];
    }
  });

  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [newStratTitle, setNewStratTitle] = useState("");
  const [newStratCategory, setNewStratCategory] = useState<MarketplaceStrategy["category"]>("SMC");
  const [newStratPrice, setNewStratPrice] = useState<MarketplaceStrategy["priceModel"]>("FREE");
  const [newStratDesc, setNewStratDesc] = useState("");

  const [selectedTraderForCopy, setSelectedTraderForCopy] = useState<TopTrader | null>(null);
  const [allocationUsd, setAllocationUsd] = useState(500);
  const [maxLeverage, setMaxLeverage] = useState(5);
  const [stopLossLimit, setStopLossLimit] = useState(10);
  const [showSuccessToast, setShowSuccessToast] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_COPIED_TRADERS, JSON.stringify(copiedMap));
  }, [copiedMap]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SUBSCRIBED_STRATEGIES, JSON.stringify(subscribedStrategies));
  }, [subscribedStrategies]);

  const activeCopiedList = Object.keys(copiedMap);

  const handleStartCopy = (trader: TopTrader) => {
    const config: CopiedConfig = {
      traderId: trader.id,
      allocationUsd,
      maxLeverage,
      stopLossLimitPct: stopLossLimit,
      copiedAt: Date.now(),
      simulatedProfit: Number((allocationUsd * (trader.roi30d / 100) * 0.12).toFixed(2)),
    };

    setCopiedMap((prev) => ({
      ...prev,
      [trader.id]: config,
    }));

    for (const pos of trader.recentPositions) {
      paperTradingEngine.executeOrder({
        symbol: pos.symbol,
        entryPrice: pos.symbol === "BTCUSDT" ? 68000 : pos.symbol === "ETHUSDT" ? 3500 : 150,
        atrValue: 500,
        direction: pos.direction,
        marketType: "Futures",
        leverage: Math.min(pos.leverage, maxLeverage),
        riskPercent: 1.5,
      });
    }

    setSelectedTraderForCopy(null);
    setShowSuccessToast(`Successfully mirroring ${trader.name} (${trader.handle})! Simulated trades synced.`);
    setTimeout(() => setShowSuccessToast(null), 5000);
  };

  const handleStopCopy = (traderId: string) => {
    setCopiedMap((prev) => {
      const next = { ...prev };
      delete next[traderId];
      return next;
    });
  };

  const handleToggleSubscribeStrategy = (stratId: string, title: string) => {
    if (subscribedStrategies.includes(stratId)) {
      setSubscribedStrategies((prev) => prev.filter((id) => id !== stratId));
      setShowSuccessToast(`Unsubscribed from strategy: ${title}`);
    } else {
      setSubscribedStrategies((prev) => [...prev, stratId]);
      setShowSuccessToast(`Subscribed to strategy "${title}"! Automated paper runner activated.`);
    }
    setTimeout(() => setShowSuccessToast(null), 5000);
  };

  const handlePublishStrategy = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStratTitle.trim()) return;
    setPublishModalOpen(false);
    setShowSuccessToast(`Strategy "${newStratTitle}" submitted to Marketplace review! Listed in your portfolio.`);
    setNewStratTitle("");
    setNewStratDesc("");
    setTimeout(() => setShowSuccessToast(null), 5000);
  };

  const totalSimulatedProfit = Object.values(copiedMap).reduce((sum, c) => sum + (c.simulatedProfit || 0), 0);
  const _totalAllocated = Object.values(copiedMap).reduce((sum, c) => sum + (c.allocationUsd || 0), 0);
  void _totalAllocated;

  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 font-mono space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl bg-[#090d16] border border-cyan-500/30 p-5 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Store className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black text-white uppercase tracking-wider">
                STRATEGY MARKETPLACE & SOCIAL COPY TRADING
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/20 text-[#00ff66] border border-emerald-500/40 uppercase">
                DECENTRALIZED QUANT HUB
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/40 uppercase">
                SIMULATION ONLY
              </span>
            </div>
            <p className="text-xs text-slate-400 font-sans mt-0.5">
              Buy, sell and auto-replicate institutional quantitative strategies. Mirror top quants with 1-click execution.
            </p>
          </div>
        </div>

        {/* Global Copied Stats */}
        <div className="flex items-center gap-4 bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs w-full md:w-auto justify-between">
          <div>
            <span className="text-[10px] text-slate-500 uppercase block">ACTIVE MIRRORS</span>
            <span className="text-sm font-bold text-cyan-400">{activeCopiedList.length} Traders</span>
          </div>
          <div className="border-l border-slate-800 pl-4">
            <span className="text-[10px] text-slate-500 uppercase block">SUBSCRIBED STRATEGIES</span>
            <span className="text-sm font-bold text-emerald-400">{subscribedStrategies.length} Active</span>
          </div>
          <div className="border-l border-slate-800 pl-4">
            <span className="text-[10px] text-slate-500 uppercase block">MIRROR REALIZED PNL</span>
            <span className={`text-sm font-bold ${totalSimulatedProfit >= 0 ? "text-[#00ff66]" : "text-[#ff3344]"}`}>
              +{totalSimulatedProfit.toFixed(2)} USDT
            </span>
          </div>
        </div>
      </div>

      {/* Subtab Switcher & Publish Action */}
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab("marketplace")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeSubTab === "marketplace"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-md shadow-cyan-950/40"
                : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-white"
            }`}
          >
            <Store className="w-4 h-4 text-cyan-400" />
            <span>Strategy Marketplace</span>
          </button>
          <button
            onClick={() => setActiveSubTab("traders")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
              activeSubTab === "traders"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-md shadow-cyan-950/40"
                : "bg-slate-900 text-slate-400 border border-slate-800 hover:text-white"
            }`}
          >
            <Users className="w-4 h-4 text-cyan-400" />
            <span>Top Quants & Traders</span>
          </button>
        </div>

        <button
          onClick={() => setPublishModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-black uppercase tracking-wider shadow-md shadow-amber-950/30 transition"
        >
          <Upload className="w-4 h-4 text-slate-950" />
          <span>Publish My Strategy</span>
        </button>
      </div>

      {/* Success Toast */}
      {showSuccessToast && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/60 text-[#00ff66] text-xs font-sans animate-in fade-in duration-200">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#00ff66]" />
          <span>{showSuccessToast}</span>
        </div>
      )}

      {/* VIEW 1: STRATEGY MARKETPLACE */}
      {activeSubTab === "marketplace" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {DEFAULT_MARKETPLACE_STRATEGIES.map((strat) => {
            const isSubscribed = subscribedStrategies.includes(strat.id);

            return (
              <div
                key={strat.id}
                className={`rounded-2xl bg-[#090d16] border p-5 transition-all shadow-xl flex flex-col justify-between ${
                  isSubscribed
                    ? "border-emerald-500/60 ring-1 ring-emerald-500/30"
                    : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <div>
                  {/* Strategy Header */}
                  <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded text-[9px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 uppercase">
                          {strat.category}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                          strat.priceModel === "FREE"
                            ? "bg-emerald-500/20 text-[#00ff66]"
                            : strat.priceModel === "PRO_EXCLUSIVE"
                            ? "bg-amber-500/20 text-amber-300"
                            : "bg-blue-500/20 text-blue-300"
                        }`}>
                          {strat.priceModel}
                        </span>
                      </div>
                      <h3 className="font-bold text-sm text-white">{strat.title}</h3>
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-400 font-sans">
                        <img
                          src={strat.authorAvatar}
                          alt={strat.author}
                          className="w-5 h-5 rounded-full object-cover"
                        />
                        <span>{strat.author}</span>
                        <span className="text-slate-500">{strat.authorHandle}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 uppercase block">30D RETURN</span>
                      <span className="text-base font-black text-[#00ff66] flex items-center justify-end gap-1">
                        <TrendingUp className="w-3.5 h-3.5" />
                        +{strat.roi30d}%
                      </span>
                    </div>
                  </div>

                  {/* Quantitative Metrics Matrix */}
                  <div className="grid grid-cols-3 gap-2 my-4 p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-center">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">WIN RATE</span>
                      <span className="text-xs font-bold text-white">{strat.backtestedWinRate}%</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">SHARPE RATIO</span>
                      <span className="text-xs font-bold text-cyan-400">{strat.sharpeRatio}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">SUBSCRIBERS</span>
                      <span className="text-xs font-bold text-amber-400">{strat.subscribers}</span>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-slate-300 font-sans mb-4 leading-relaxed">
                    {strat.description}
                  </p>

                  {/* Indicator tags */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {strat.keyIndicators.map((ind, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded text-[10px] bg-slate-900 border border-slate-800 text-slate-400 font-sans"
                      >
                        {ind}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Subscription Action Button */}
                <div className="pt-3 border-t border-slate-800">
                  {isSubscribed ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-[#00ff66] font-bold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" />
                        Subscribed & Running
                      </span>
                      <button
                        onClick={() => handleToggleSubscribeStrategy(strat.id, strat.title)}
                        className="px-4 py-2 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-500/50 text-red-300 text-xs font-bold uppercase transition"
                      >
                        UNSUBSCRIBE
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleToggleSubscribeStrategy(strat.id, strat.title)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-cyan-950/40"
                    >
                      <Zap className="w-4 h-4 fill-slate-950" />
                      <span>SUBSCRIBE & RUN STRATEGY ({strat.priceModel})</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW 2: TOP QUANTS & TRADERS */}
      {activeSubTab === "traders" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {TOP_TRADERS.map((trader) => {
            const isCopied = !!copiedMap[trader.id];
            const copyDetails = copiedMap[trader.id];

            return (
              <div
                key={trader.id}
                className={`rounded-2xl bg-[#090d16] border p-5 transition-all shadow-xl flex flex-col justify-between ${
                  isCopied ? "border-emerald-500/60 ring-1 ring-emerald-500/30" : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                      <img
                        src={trader.avatar}
                        alt={trader.name}
                        className="w-12 h-12 rounded-xl object-cover border border-slate-700"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white">{trader.name}</span>
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                            {trader.tier}
                          </span>
                        </div>
                        <span className="text-xs text-slate-500 font-sans">{trader.handle}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 uppercase block">30D ROI</span>
                      <span className="text-base font-black text-[#00ff66] flex items-center justify-end gap-1">
                        <TrendingUp className="w-3.5 h-3.5" />
                        +{trader.roi30d}%
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 my-4 p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-center">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">WIN RATE</span>
                      <span className="text-xs font-bold text-white">{trader.winRate}%</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">MAX DRAWDOWN</span>
                      <span className="text-xs font-bold text-[#ff3344]">{trader.maxDrawdown}%</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase block">AUM / FOLLOWERS</span>
                      <span className="text-xs font-bold text-cyan-400">{trader.aum} ({trader.followers})</span>
                    </div>
                  </div>

                  <div className="mb-4">
                    <span className="text-[10px] text-slate-500 uppercase block mb-1">PROVEN STRATEGY</span>
                    <div className="text-xs text-slate-300 font-sans bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/80 flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>{trader.strategy}</span>
                    </div>
                  </div>

                  <div className="mb-4 space-y-1.5">
                    <span className="text-[10px] text-slate-500 uppercase block">
                      LIVE POSITIONS ({trader.recentPositions.length})
                    </span>
                    <div className="space-y-1">
                      {trader.recentPositions.map((pos, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800/60"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-bold px-1 rounded ${pos.direction === "LONG" ? "bg-green-500/20 text-[#00ff66]" : "bg-red-500/20 text-[#ff3344]"}`}>
                              {pos.direction} {pos.leverage}x
                            </span>
                            <span className="font-bold text-white">{pos.symbol}</span>
                          </div>
                          <span className="text-[#00ff66] font-bold">+{pos.pnlPct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800">
                  {isCopied ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs">
                        <span className="text-[10px] text-slate-500 uppercase block">MIRROR STATUS</span>
                        <span className="text-[#00ff66] font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Mirrored (${copyDetails.allocationUsd} USDT)
                        </span>
                      </div>
                      <button
                        onClick={() => handleStopCopy(trader.id)}
                        className="px-4 py-2 rounded-lg bg-red-950/60 hover:bg-red-900/60 border border-red-500/50 text-red-300 text-xs font-bold uppercase transition"
                      >
                        STOP COPYING
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setSelectedTraderForCopy(trader)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-cyan-950/40"
                    >
                      <UserCheck className="w-4 h-4 fill-slate-950" />
                      <span>COPY TRADER ({trader.roi30d}% ROI)</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Publish Strategy Modal */}
      {publishModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-[#090d16] border border-cyan-500/50 p-6 shadow-2xl font-mono space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white uppercase flex items-center gap-2">
                <Upload className="w-4 h-4 text-cyan-400" />
                Publish Algorithm to Marketplace
              </h3>
              <button
                onClick={() => setPublishModalOpen(false)}
                className="text-slate-500 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePublishStrategy} className="space-y-4 font-sans text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-mono uppercase text-[11px]">
                  Strategy Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SMC Order Block Scalper v2"
                  value={newStratTitle}
                  onChange={(e) => setNewStratTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1 font-mono uppercase text-[11px]">
                    Category
                  </label>
                  <select
                    value={newStratCategory}
                    onChange={(e) => setNewStratCategory(e.target.value as MarketplaceStrategy["category"])}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono outline-none focus:border-cyan-500"
                  >
                    <option value="SMC">Smart Money (SMC)</option>
                    <option value="SCALPING">High-Freq Scalping</option>
                    <option value="SWING">Trend Swing</option>
                    <option value="GRID">Volatility Grid</option>
                    <option value="ARBITRAGE">Delta Neutral</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1 font-mono uppercase text-[11px]">
                    Monetization
                  </label>
                  <select
                    value={newStratPrice}
                    onChange={(e) => setNewStratPrice(e.target.value as MarketplaceStrategy["priceModel"])}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono outline-none focus:border-cyan-500"
                  >
                    <option value="FREE">Free for Community</option>
                    <option value="PRO_EXCLUSIVE">Pro Tier Only</option>
                    <option value="$29/mo">$29 / month</option>
                    <option value="$49/mo">$49 / month</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-mono uppercase text-[11px]">
                  Strategy Logic & Risk Rules
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Describe your strategy logic, indicators, and recommended stop loss..."
                  value={newStratDesc}
                  onChange={(e) => setNewStratDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-sans outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPublishModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs uppercase"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs uppercase tracking-wider shadow-md shadow-cyan-950/40"
                >
                  SUBMIT TO MARKETPLACE
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Copy Settings Modal */}
      {selectedTraderForCopy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-[#090d16] border border-cyan-500/50 p-6 shadow-2xl font-mono space-y-5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <img
                  src={selectedTraderForCopy.avatar}
                  alt={selectedTraderForCopy.name}
                  className="w-10 h-10 rounded-xl object-cover border border-slate-700"
                />
                <div>
                  <h3 className="text-sm font-bold text-white uppercase">
                    COPY {selectedTraderForCopy.name}
                  </h3>
                  <span className="text-xs text-slate-400">{selectedTraderForCopy.handle}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedTraderForCopy(null)}
                className="text-slate-500 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 font-sans text-xs">
              <div>
                <label className="text-slate-400 block mb-1 font-mono uppercase text-[11px]">
                  VIRTUAL ALLOCATION (USDT)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono">$</span>
                  <input
                    type="number"
                    value={allocationUsd}
                    onChange={(e) => setAllocationUsd(Number(e.target.value) || 100)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-white font-mono font-bold outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-mono uppercase text-[11px]">
                  MAX LEVERAGE CAP
                </label>
                <select
                  value={maxLeverage}
                  onChange={(e) => setMaxLeverage(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono outline-none focus:border-cyan-500"
                >
                  <option value={1}>1x (Spot equivalent)</option>
                  <option value={2}>2x Conservative</option>
                  <option value={3}>3x Moderate</option>
                  <option value={5}>5x Standard Institutional</option>
                  <option value={10}>10x High Volatility</option>
                </select>
              </div>

              <div>
                <label className="text-slate-400 block mb-1 font-mono uppercase text-[11px]">
                  STOP LOSS DRAWDOWN SAFEGUARD (%)
                </label>
                <input
                  type="number"
                  value={stopLossLimit}
                  onChange={(e) => setStopLossLimit(Number(e.target.value) || 5)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono font-bold outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setSelectedTraderForCopy(null)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs uppercase"
              >
                Cancel
              </button>
              <button
                onClick={() => handleStartCopy(selectedTraderForCopy)}
                className="px-5 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-slate-950 font-black text-xs uppercase tracking-wider shadow-md shadow-emerald-950/40"
              >
                CONFIRM & COPY TRADES
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
