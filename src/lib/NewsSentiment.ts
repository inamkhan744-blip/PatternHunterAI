export interface NewsItem {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  url?: string;
}

export type SentimentType = "Bullish" | "Bearish" | "Neutral";

export interface SentimentAnalysisResult {
  sentiment: SentimentType;
  score: number; // 0 to 100 confidence
  summary: string;
  topHeadlines: NewsItem[];
  modelUsed: string;
  updatedAt: string;
}

const MOCK_NEWS_HEADLINES: NewsItem[] = [
  {
    id: "news-1",
    title: "Institutional Bitcoin Inflows Surge Past $1.2B as Spot ETFs Record 7th Consecutive Day of Inflows",
    source: "CoinDesk",
    publishedAt: "15m ago",
    url: "https://cryptopanic.com",
  },
  {
    id: "news-2",
    title: "Federal Reserve Signals Potential Rate Cuts Amid Stabilizing Inflation Metrics",
    source: "Bloomberg Crypto",
    publishedAt: "42m ago",
    url: "https://cryptopanic.com",
  },
  {
    id: "news-3",
    title: "Ethereum L2 Network TVL Hits All-Time High Surpassing $45 Billion",
    source: "CoinTelegraph",
    publishedAt: "1h ago",
    url: "https://cryptopanic.com",
  },
  {
    id: "news-4",
    title: "Solana DeFi Trading Volume Outpaces Mainnet Rivals for Third Consecutive Week",
    source: "Decrypt",
    publishedAt: "2h ago",
    url: "https://cryptopanic.com",
  },
  {
    id: "news-5",
    title: "Global Central Banks Advance Wholesale CBDC and Cross-Border Liquidity Frameworks",
    source: "Reuters",
    publishedAt: "3h ago",
    url: "https://cryptopanic.com",
  },
  {
    id: "news-6",
    title: "Crypto Derivatives Open Interest Sets Record Ahead of Monthly Options Expiry",
    source: "The Block",
    publishedAt: "4h ago",
    url: "https://cryptopanic.com",
  },
];

/**
 * Fetches recent crypto news using CryptoPanic API if an API key is provided,
 * otherwise falls back to realistic mock crypto news items.
 */
export async function fetchCryptoNews(): Promise<NewsItem[]> {
  const apiKey = (import.meta.env.VITE_CRYPTOPANIC_API_KEY as string | undefined)?.trim();

  if (apiKey) {
    try {
      const url = `https://cryptopanic.com/api/v1/posts/?auth_token=${apiKey}&public=true&filter=rising`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.results) && data.results.length > 0) {
          return data.results.slice(0, 5).map((item: { id: number | string; title: string; domain?: string; source?: { title: string }; created_at?: string; url?: string }) => ({
            id: String(item.id),
            title: item.title,
            source: item.source?.title || item.domain || "CryptoPanic",
            publishedAt: item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recent",
            url: item.url,
          }));
        }
      }
    } catch (e) {
      console.warn("CryptoPanic API fetch failed or timed out, using fallback news feed.", e);
    }
  }

  // Fallback to top mock news headlines
  return MOCK_NEWS_HEADLINES.slice(0, 5);
}

/**
 * Keyword-based heuristic analyzer when Gemini API is unavailable or returns an error.
 */
function analyzeSentimentHeuristically(headlines: string[]): { sentiment: SentimentType; score: number; summary: string } {
  const bullishKeywords = [
    "surge", "surpasses", "record", "inflow", "inflows", "bull", "rally", "growth",
    "high", "ath", "rate cut", "cuts", "gain", "breakout", "jump", "positive", "buying"
  ];
  const bearishKeywords = [
    "drop", "crash", "plunge", "ban", "crackdown", "hack", "exploit", "outflow",
    "loss", "bear", "down", "liquidation", "fraud", "sec sue", "inflation surge", "rejection"
  ];

  let bullScore = 0;
  let bearScore = 0;

  for (const headline of headlines) {
    const text = headline.toLowerCase();
    for (const kw of bullishKeywords) {
      if (text.includes(kw)) bullScore += 1;
    }
    for (const kw of bearishKeywords) {
      if (text.includes(kw)) bearScore += 1;
    }
  }

  if (bullScore > bearScore) {
    const confidence = Math.min(95, Math.max(65, 60 + (bullScore - bearScore) * 10));
    return {
      sentiment: "Bullish",
      score: confidence,
      summary: "Macro inflows and positive network momentum drive strong buying sentiment across top headlines.",
    };
  } else if (bearScore > bullScore) {
    const confidence = Math.min(95, Math.max(65, 60 + (bearScore - bullScore) * 10));
    return {
      sentiment: "Bearish",
      score: confidence,
      summary: "Negative regulatory or liquidity pressure headlines are weighing on market sentiment.",
    };
  } else {
    return {
      sentiment: "Neutral",
      score: 50,
      summary: "Mixed market signals across institutional inflows and macroeconomic consolidation.",
    };
  }
}

/**
 * Passes the top 5 headlines to Gemini API to determine overall sentiment: "Bullish", "Bearish", or "Neutral".
 */
import { getGeminiApiKey, getSelectedModel } from "./ModelManager";

export async function analyzeNewsSentiment(headlines: NewsItem[]): Promise<SentimentAnalysisResult> {
  const top5 = headlines.slice(0, 5);
  const headlineTexts = top5.map((h, i) => `${i + 1}. ${h.title}`);
  const geminiApiKey = getGeminiApiKey();

  if (geminiApiKey) {
    const prompt = `You are a crypto market sentiment analyst. Analyze the following 5 crypto headlines and classify the overall sentiment.
Respond STRICTLY with a valid JSON object in this exact format:
{
  "sentiment": "Bullish" | "Bearish" | "Neutral",
  "score": number between 50 and 99,
  "summary": "1-2 concise sentences explaining why"
}

Headlines:
${headlineTexts.join("\n")}`;

    const selectedModel = getSelectedModel();
    const models = Array.from(new Set([selectedModel, "gemini-2.0-flash", "gemini-1.5-flash", "gemini-2.0-flash-001"]));

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json" },
            }),
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const parsed = JSON.parse(rawText);
            const sentiment: SentimentType =
              parsed.sentiment === "Bullish" || parsed.sentiment === "Bearish" || parsed.sentiment === "Neutral"
                ? parsed.sentiment
                : "Neutral";
            const score = typeof parsed.score === "number" ? Math.min(100, Math.max(0, parsed.score)) : 75;
            const summary = parsed.summary || `Overall market outlook evaluated as ${sentiment}.`;

            return {
              sentiment,
              score,
              summary,
              topHeadlines: top5,
              modelUsed: `Gemini (${model})`,
              updatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            };
          }
        }
      } catch (err) {
        console.warn(`Gemini sentiment call failed with model ${model}:`, err);
      }
    }
  }

  // Fallback to keyword-based heuristic analysis
  const heuristic = analyzeSentimentHeuristically(top5.map((h) => h.title));
  return {
    sentiment: heuristic.sentiment,
    score: heuristic.score,
    summary: heuristic.summary,
    topHeadlines: top5,
    modelUsed: "AI Engine (Fallback Heuristic)",
    updatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}
