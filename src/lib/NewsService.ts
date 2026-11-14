import { COINS, PRO_COINS } from "../constants";

export interface NewsEvent {
  id: string;
  title: string;
  url: string;
  symbols: string[];
  publishedAt: string;
  negative: boolean;
}

const NEWS_URL = "https://cryptocurrency.cv/api/news";

const COIN_NAME_MAP: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  binance: "BNB",
  ripple: "XRP",
  cardano: "ADA",
  dogecoin: "DOGE",
  avalanche: "AVAX",
  polkadot: "DOT",
  chainlink: "LINK",
  litecoin: "LTC",
  polygon: "MATIC",
  tron: "TRX",
  cosmos: "ATOM",
  uniswap: "UNI",
  aptos: "APT",
  near: "NEAR",
  arbitrum: "ARB",
  optimism: "OP",
  injective: "INJ",
  sui: "SUI",
  celestia: "TIA",
  sei: "SEI",
  thorchain: "RUNE",
  fantom: "FTM",
  thegraph: "GRT",
  aave: "AAVE",
  maker: "MKR",
  pepe: "PEPE",
  fetch: "FET",
  render: "RNDR",
  immutable: "IMX",
  stacks: "STX",
  gala: "GALA",
  sandbox: "SAND",
  decentraland: "MANA",
  axie: "AXS",
  theta: "THETA",
  tezos: "XTZ",
  chiliz: "CHZ",
  curve: "CRV",
  lido: "LDO",
  dydx: "DYDX",
  stellar: "XLM",
  vechain: "VET",
  hedera: "HBAR",
  "internet computer": "ICP",
};

const KNOWN_COINS = [...COINS, ...PRO_COINS];

const NEGATIVE_KEYWORDS = [
  "hack",
  "exploit",
  "crash",
  "ban",
  "lawsuit",
  "sec",
  "fraud",
  "scam",
  "liquidation",
  "dump",
  "plunge",
  "rug",
  "bearish",
];

function extractSymbols(text: string): string[] {
  const symbols = new Set<string>();
  const lower = text.toLowerCase();

  for (const [name, symbol] of Object.entries(COIN_NAME_MAP)) {
    if (lower.includes(name)) symbols.add(symbol);
  }

  for (const coin of KNOWN_COINS) {
    const escaped = coin.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(?:^|[^A-Za-z0-9])#?${escaped}(?:[\\/\\-_ ]?(?:USD|USDT|USDC))?(?:[^A-Za-z0-9]|$)`,
      "i"
    );
    if (pattern.test(text)) {
      symbols.add(coin.symbol);
    }
  }

  return [...symbols];
}

function isNegative(title: string, description: string): boolean {
  const lower = `${title} ${description}`.toLowerCase();
  return NEGATIVE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export async function fetchLatestNews(): Promise<NewsEvent[]> {
  const response = await fetch(NEWS_URL);
  if (!response.ok) {
    throw new Error(`News request failed (${response.status})`);
  }

    const data = (await response.json()) as {
      articles?: Array<{
        title: string;
        description?: string;
        link: string;
        pubDate: string;
        source?: string;
      }>;
    };

    return (data.articles || [])
      .map((article, index) => {
        const text = `${article.title} ${article.description || ""}`;
        return {
          id: article.link || String(index),
          title: article.title,
          url: article.link,
          symbols: extractSymbols(text),
          publishedAt: article.pubDate,
          negative: isNegative(article.title, article.description || ""),
        };
      })
      .filter((event) => event.symbols.length > 0)
      .slice(0, 20);
}
