import { encryptData, decryptData } from "./CryptoSecurity";

export type ExchangeId = "binance" | "bybit" | "kucoin" | "okx";

export type ExchangeIntegrationStatus = "LIVE_INTEGRATED" | "PUBLIC_MARKET_ONLY" | "UNAVAILABLE";

export interface ExchangeConfig {
  id: ExchangeId;
  name: string;
  iconText: string;
  color: string;
  description: string;
  requiresPassphrase?: boolean;
  status: ExchangeIntegrationStatus;
  capabilities: {
    marketData: boolean;
    paperTrading: boolean;
    liveTrading: boolean;
    balanceFetch: boolean;
    orderManagement: boolean;
  };
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  testnet?: boolean;
}

export interface UnifiedBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

export interface UnifiedOrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  clientOrderId?: string;
}

export interface UnifiedOrderResult {
  orderId: string;
  symbol: string;
  status: "FILLED" | "NEW" | "PARTIALLY_FILLED" | "CANCELED" | "REJECTED";
  executedQty: number;
  price: number;
  rawResponse?: unknown;
}

export const SUPPORTED_EXCHANGES: ExchangeConfig[] = [
  {
    id: "binance",
    name: "Binance",
    iconText: "BNB",
    color: "#F3BA2F",
    description: "World's largest crypto exchange by volume (Spot & USDⓈ-M Futures)",
    requiresPassphrase: false,
    status: "LIVE_INTEGRATED",
    capabilities: {
      marketData: true,
      paperTrading: true,
      liveTrading: true,
      balanceFetch: true,
      orderManagement: true,
    },
  },
  {
    id: "bybit",
    name: "Bybit",
    iconText: "BYB",
    color: "#F7A600",
    description: "Leading derivative & inverse perpetual exchange (Public Market Data & Paper Trading)",
    requiresPassphrase: false,
    status: "PUBLIC_MARKET_ONLY",
    capabilities: {
      marketData: true,
      paperTrading: true,
      liveTrading: false,
      balanceFetch: false,
      orderManagement: false,
    },
  },
  {
    id: "okx",
    name: "OKX",
    iconText: "OKX",
    color: "#FFFFFF",
    description: "Institutional multi-currency margin platform (Public Market Data & Paper Trading)",
    requiresPassphrase: true,
    status: "PUBLIC_MARKET_ONLY",
    capabilities: {
      marketData: true,
      paperTrading: true,
      liveTrading: false,
      balanceFetch: false,
      orderManagement: false,
    },
  },
  {
    id: "kucoin",
    name: "KuCoin",
    iconText: "KCS",
    color: "#24AE8F",
    description: "Top altcoin exchange with deep liquidity (Public Market Data & Paper Trading)",
    requiresPassphrase: true,
    status: "PUBLIC_MARKET_ONLY",
    capabilities: {
      marketData: true,
      paperTrading: true,
      liveTrading: false,
      balanceFetch: false,
      orderManagement: false,
    },
  },
];

const STORAGE_KEY_ACTIVE_EXCHANGE = "fortress_active_exchange";
const STORAGE_KEY_EXCHANGE_KEYS_PREFIX = "fortress_exchange_creds_";

export function getActiveExchange(): ExchangeId {
  if (typeof localStorage === "undefined") return "binance";
  const stored = localStorage.getItem(STORAGE_KEY_ACTIVE_EXCHANGE);
  if (stored && (stored === "binance" || stored === "bybit" || stored === "kucoin" || stored === "okx")) {
    return stored as ExchangeId;
  }
  return "binance";
}

export function setActiveExchange(exchangeId: ExchangeId): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY_ACTIVE_EXCHANGE, exchangeId);
  }
}

export function saveExchangeCredentials(
  exchangeId: ExchangeId,
  credentials: ExchangeCredentials
): void {
  if (typeof localStorage === "undefined") return;
  const serialized = JSON.stringify(credentials);
  const encrypted = encryptData(serialized);
  localStorage.setItem(`${STORAGE_KEY_EXCHANGE_KEYS_PREFIX}${exchangeId}`, encrypted);
}

export function getExchangeCredentials(exchangeId: ExchangeId): ExchangeCredentials {
  if (typeof localStorage === "undefined") return { apiKey: "", apiSecret: "" };
  const raw = localStorage.getItem(`${STORAGE_KEY_EXCHANGE_KEYS_PREFIX}${exchangeId}`);
  if (!raw) return { apiKey: "", apiSecret: "" };

  try {
    const decrypted = decryptData(raw);
    if (!decrypted) return { apiKey: "", apiSecret: "" };
    return JSON.parse(decrypted) as ExchangeCredentials;
  } catch {
    return { apiKey: "", apiSecret: "" };
  }
}

export function isExchangeConnected(exchangeId: ExchangeId): boolean {
  const creds = getExchangeCredentials(exchangeId);
  return Boolean(creds.apiKey?.trim() && creds.apiSecret?.trim());
}

export class UnifiedExchangeAdapter {
  private exchangeId: ExchangeId;

  constructor(exchangeId: ExchangeId = getActiveExchange()) {
    this.exchangeId = exchangeId;
  }

  public getExchangeId(): ExchangeId {
    return this.exchangeId;
  }

  public getConfig(): ExchangeConfig {
    return SUPPORTED_EXCHANGES.find((ex) => ex.id === this.exchangeId)!;
  }

  public async fetchTickerPrice(symbol: string): Promise<number> {
    const cleanSym = symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase();

    if (this.exchangeId === "binance") {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanSym}`);
      if (!res.ok) throw new Error(`Binance price fetch failed: ${res.status}`);
      const data = await res.json();
      return parseFloat(data.price);
    }

    if (this.exchangeId === "bybit") {
      const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${cleanSym}`);
      if (!res.ok) throw new Error(`Bybit price fetch failed: ${res.status}`);
      const data = await res.json();
      const item = data.result?.list?.[0];
      if (!item) throw new Error(`Symbol ${cleanSym} not found on Bybit`);
      return parseFloat(item.lastPrice);
    }

    if (this.exchangeId === "okx") {
      const okxSym = cleanSym.endsWith("USDT") ? `${cleanSym.replace("USDT", "")}-USDT` : cleanSym;
      const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${okxSym}`);
      if (!res.ok) throw new Error(`OKX price fetch failed: ${res.status}`);
      const data = await res.json();
      const item = data.data?.[0];
      if (!item) throw new Error(`Symbol ${okxSym} not found on OKX`);
      return parseFloat(item.last);
    }

    if (this.exchangeId === "kucoin") {
      const kucoinSym = cleanSym.endsWith("USDT") ? `${cleanSym.replace("USDT", "")}-USDT` : cleanSym;
      const res = await fetch(`https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=${kucoinSym}`);
      if (!res.ok) throw new Error(`KuCoin price fetch failed: ${res.status}`);
      const data = await res.json();
      if (!data.data?.price) throw new Error(`Symbol ${kucoinSym} not found on KuCoin`);
      return parseFloat(data.data.price);
    }

    throw new Error(`Unsupported exchange: ${this.exchangeId}`);
  }

  public async testConnectivity(): Promise<{ success: boolean; latencyMs: number; message?: string }> {
    return testExchangeConnectivity(this.exchangeId);
  }
}

export async function testExchangeConnectivity(exchangeId: ExchangeId): Promise<{
  success: boolean;
  latencyMs: number;
  message?: string;
}> {
  const start = Date.now();
  try {
    let url = "";
    if (exchangeId === "binance") {
      url = "https://api.binance.com/api/v3/ping";
    } else if (exchangeId === "bybit") {
      url = "https://api.bybit.com/v5/market/time";
    } else if (exchangeId === "okx") {
      url = "https://www.okx.com/api/v5/public/time";
    } else if (exchangeId === "kucoin") {
      url = "https://api.kucoin.com/api/v1/timestamp";
    }

    const res = await fetch(url, { method: "GET" });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      return { success: true, latencyMs };
    }
    return { success: false, latencyMs, message: `Status code ${res.status}` };
  } catch (err) {
    return {
      success: false,
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : "Network error",
    };
  }
}
