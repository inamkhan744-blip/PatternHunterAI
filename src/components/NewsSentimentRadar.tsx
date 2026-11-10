import { useEffect, useState, useCallback } from "react";
import {
  Radar,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Sparkles,
  Newspaper,
  ChevronRight,
} from "lucide-react";
import {
  fetchCryptoNews,
  analyzeNewsSentiment,
  type SentimentAnalysisResult,
  type SentimentType,
} from "../lib/NewsSentiment";

interface Props {
  className?: string;
  compact?: boolean;
}

export default function NewsSentimentRadar({ className = "", compact = false }: Props) {
  const [data, setData] = useState<SentimentAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const loadSentiment = useCallback(async () => {
    setLoading(true);
    try {
      const news = await fetchCryptoNews();
      const analysis = await analyzeNewsSentiment(news);
      setData(analysis);
    } catch (e) {
      console.error("Failed to load news sentiment:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSentiment();
    // Refresh sentiment every 5 minutes
    const interval = setInterval(loadSentiment, 300000);
    return () => clearInterval(interval);
  }, [loadSentiment]);

  const sentiment = data?.sentiment ?? "Neutral";

  const getSentimentBadge = (s: SentimentType) => {
    switch (s) {
      case "Bullish":
        return {
          bg: "bg-green-500/15 border-green-500/30 text-green-400",
          radarColor: "text-green-400",
          pulseColor: "bg-green-400",
          icon: TrendingUp,
          label: "Bullish",
        };
      case "Bearish":
        return {
          bg: "bg-red-500/15 border-red-500/30 text-red-400",
          radarColor: "text-red-400",
          pulseColor: "bg-red-400",
          icon: TrendingDown,
          label: "Bearish",
        };
      default:
        return {
          bg: "bg-amber-500/15 border-amber-500/30 text-amber-400",
          radarColor: "text-amber-400",
          pulseColor: "bg-amber-400",
          icon: Minus,
          label: "Neutral",
        };
    }
  };

  const badge = getSentimentBadge(sentiment);
  const IconComponent = badge.icon;

  if (compact) {
    return (
      <div className={`relative inline-flex items-center gap-2 ${className}`}>
        <button
          onClick={() => setExpanded((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all ${badge.bg}`}
          title="AI News Sentiment Radar (Click to expand)"
        >
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${badge.pulseColor}`}
            />
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${badge.pulseColor}`}
            />
          </span>
          <Radar className={`w-3.5 h-3.5 ${badge.radarColor}`} />
          <span>News: {badge.label}</span>
          {data && <span className="opacity-75 text-[10px]">({data.score}%)</span>}
        </button>

        {expanded && data && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} />
            <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-4 z-50 text-left">
              <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Radar className={`w-4 h-4 ${badge.radarColor}`} />
                  <span className="text-sm font-bold text-white">AI News Radar</span>
                </div>
                <button
                  onClick={loadSentiment}
                  disabled={loading}
                  className="p-1 rounded-md text-slate-400 hover:text-white transition-colors"
                  title="Refresh news sentiment"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              <div className="mb-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-400">Sentiment Bias:</span>
                  <span className={`font-bold ${badge.bg} px-2 py-0.5 rounded border text-[11px]`}>
                    {badge.label} ({data.score}%)
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed bg-slate-800/60 p-2.5 rounded-lg border border-slate-800">
                  {data.summary}
                </p>
                <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                  <span>Engine: {data.modelUsed}</span>
                  <span>Updated: {data.updatedAt}</span>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider mb-2 flex items-center gap-1">
                  <Newspaper className="w-3 h-3 text-cyan-400" />
                  Top Headlines (CryptoPanic)
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {data.topHeadlines.map((news) => (
                    <div
                      key={news.id}
                      className="p-2 rounded-lg bg-slate-800/40 hover:bg-slate-800 border border-slate-800/80 transition-colors text-xs"
                    >
                      <a
                        href={news.url || "https://cryptopanic.com"}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-200 hover:text-cyan-400 font-medium block leading-snug line-clamp-2"
                      >
                        {news.title}
                      </a>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                        <span>{news.source}</span>
                        <span>{news.publishedAt}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-2xl bg-slate-900 border border-slate-800 p-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center">
            <Radar className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
              AI News Sentiment Radar
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            </h4>
            <span className="text-[10px] text-slate-500">CryptoPanic + Gemini AI</span>
          </div>
        </div>

        <button
          onClick={loadSentiment}
          disabled={loading}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          title="Refresh Sentiment"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Main Sentiment Card */}
      <div className="mb-3">
        <div
          className={`p-3 rounded-xl border flex items-center justify-between ${badge.bg}`}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-slate-900/60">
              <IconComponent className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">Current Outlook:</span>
                <span className="text-sm font-bold tracking-wide">{badge.label}</span>
              </div>
              <span className="text-[11px] text-slate-300 font-medium">
                AI Confidence: {data?.score ?? 50}%
              </span>
            </div>
          </div>
          <div className="text-right">
            <span className="relative flex h-3 w-3 ml-auto mr-1">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${badge.pulseColor}`}
              />
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${badge.pulseColor}`}
              />
            </span>
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block mt-1">Live</span>
          </div>
        </div>

        {data?.summary && (
          <p className="text-xs text-slate-300 mt-2 bg-slate-950/50 p-2.5 rounded-lg border border-slate-800/80 leading-relaxed">
            {data.summary}
          </p>
        )}
      </div>

      {/* Headlines List */}
      <div>
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
          <span className="font-semibold uppercase tracking-wider text-[10px] text-slate-500">
            Top 5 Headlines
          </span>
          <span className="text-[10px] text-slate-500">
            {data?.updatedAt ? `Updated ${data.updatedAt}` : ""}
          </span>
        </div>

        {loading && !data ? (
          <div className="py-6 flex items-center justify-center text-xs text-slate-500 gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
            <span>Analyzing news sentiment…</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {data?.topHeadlines.map((news) => (
              <a
                key={news.id}
                href={news.url || "https://cryptopanic.com"}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between p-2 rounded-lg bg-slate-950/40 hover:bg-slate-800/60 border border-slate-800/60 transition-colors text-xs"
              >
                <div className="min-w-0 pr-2">
                  <p className="text-slate-300 group-hover:text-cyan-400 font-medium truncate leading-tight">
                    {news.title}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                    <span>{news.source}</span>
                    <span>·</span>
                    <span>{news.publishedAt}</span>
                  </div>
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-slate-300 shrink-0" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
