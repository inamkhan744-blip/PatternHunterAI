import { COINS, PRO_COINS } from "../constants";

export interface NewsEvent {
  id: string;
  title: string;
  url: string;
  symbols: string[];
  publishedAt: string;
  negative: boolean;
}

const API_KEY = import.meta.env.VITE_CRYPTOPANIC_API_KEY as string | undefined;
const BASE_URL = "https://cryptopanic.com/api/developer/v2/posts/";

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
];

function extractSymbols(text: string, apiCurrencies: string[] = []): string[] {
  const symbols = new Set<string>(apiCurrencies.map((currency) => currency.toUpperCase()));
  const lower = text.toLowerCase();

  for (const [name, symbol] of Object.entries(COIN_NAME_MAP)) {
    if (lower.includes(name)) symbols.add(symbol);
  }

  for (const coin of KNOWN_COINS) {
    if (new RegExp(`\\b${coin.symbol}\\b`, "i").test(text)) {
      symbols.add(coin.symbol);
    }
  }

  const tickerMatches = text.match(/\b[A-Z]{2,6}\b/g) || [];
  for (const match of tickerMatches) {
    if (KNOWN_COINS.some((coin) => coin.symbol === match)) {
      symbols.add(match);
    }
  }

  return [...symbols];
}

function isNegative(title: string): boolean {
  const lower = title.toLowerCase();
  return NEGATIVE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export async function fetchLatestNews(): Promise<NewsEvent[]> {
  if (!API_KEY) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      auth_token: API_KEY,
      public: "true",
      kind: "news",
      filter: "hot",
    });
    const response = await fetch(`${BASE_URL}?${params.toString()}`);
    if (!response.ok) return [];

    const data = (await response.json()) as {
      results?: Array<{
        id: string | number;
        title: string;
        url: string;
        published_at: string;
        currencies?: Array<{ code: string }>;
      }>;
    };

    return (data.results || [])
      .map((post) => {
        const apiCurrencies = (post.currencies || []).map((currency) => currency.code);
        const symbols = extractSymbols(post.title, apiCurrencies);
        return {
          id: String(post.id),
          title: post.title,
          url: post.url,
          symbols,
          publishedAt: post.published_at,
          negative: isNegative(post.title),
        };
      })
      .filter((event) => event.symbols.length > 0);
  } catch {
    return [];
  }
}
