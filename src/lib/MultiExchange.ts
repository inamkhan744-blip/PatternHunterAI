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
    description: "Leading derivative & inverse perpetual exchange (V5 Unified Trading API)",
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
    id: "okx",
    name: "OKX",
    iconText: "OKX",
    color: "#FFFFFF",
    description: "Institutional multi-currency margin platform (V5 Trade REST API)",
    requiresPassphrase: true,
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

  /**
   * Fetches unified account wallet balances
   */
  public async fetchBalances(): Promise<UnifiedBalance[]> {
    const creds = getExchangeCredentials(this.exchangeId);
    if (!creds.apiKey || !creds.apiSecret) {
      throw new Error(`API keys missing for ${this.exchangeId}. Connect credentials in Settings.`);
    }

    if (this.exchangeId === "bybit") {
      const timestamp = Date.now().toString();
      const recvWindow = "5000";
      const queryString = "accountType=UNIFIED";
      const signString = timestamp + creds.apiKey + recvWindow + queryString;
      const signature = await signHmacSha256(signString, creds.apiSecret);

      const res = await fetch(`https://api.bybit.com/v5/account/wallet-balance?${queryString}`, {
        headers: {
          "X-BAPI-API-KEY": creds.apiKey,
          "X-BAPI-TIMESTAMP": timestamp,
          "X-BAPI-SIGN": signature,
          "X-BAPI-RECV-WINDOW": recvWindow,
        },
      });
      if (!res.ok) throw new Error(`Bybit wallet-balance failed: ${res.status}`);
      const data = await res.json();
      const coins = data.result?.list?.[0]?.coin || [];
      return coins.map((c: { coin: string; walletBalance: string; locked: string }) => ({
        asset: c.coin,
        free: parseFloat(c.walletBalance) - parseFloat(c.locked || "0"),
        locked: parseFloat(c.locked || "0"),
        total: parseFloat(c.walletBalance),
      }));
    }

    if (this.exchangeId === "okx") {
      const timestamp = new Date().toISOString();
      const method = "GET";
      const requestPath = "/api/v5/account/balance";
      const signString = timestamp + method + requestPath;
      const signature = await signHmacSha256Base64(signString, creds.apiSecret);

      const res = await fetch(`https://www.okx.com${requestPath}`, {
        headers: {
          "OK-ACCESS-KEY": creds.apiKey,
          "OK-ACCESS-SIGN": signature,
          "OK-ACCESS-TIMESTAMP": timestamp,
          "OK-ACCESS-PASSPHRASE": creds.passphrase || "",
        },
      });
      if (!res.ok) throw new Error(`OKX account-balance failed: ${res.status}`);
      const data = await res.json();
      const details = data.data?.[0]?.details || [];
      return details.map((d: { ccy: string; availBal: string; frozenBal: string; eq: string }) => ({
        asset: d.ccy,
        free: parseFloat(d.availBal || "0"),
        locked: parseFloat(d.frozenBal || "0"),
        total: parseFloat(d.eq || "0"),
      }));
    }

    throw new Error(`Live balance fetching not implemented for ${this.exchangeId}`);
  }

  /**
   * Places an order across supported live exchanges
   */
  public async placeOrder(req: UnifiedOrderRequest): Promise<UnifiedOrderResult> {
    const creds = getExchangeCredentials(this.exchangeId);
    if (!creds.apiKey || !creds.apiSecret) {
      throw new Error(`API keys missing for ${this.exchangeId}. Connect credentials in Settings.`);
    }

    if (this.exchangeId === "bybit") {
      const timestamp = Date.now().toString();
      const recvWindow = "5000";
      const body = JSON.stringify({
        category: "spot",
        symbol: req.symbol.toUpperCase(),
        side: req.side === "BUY" ? "Buy" : "Sell",
        orderType: req.type === "MARKET" ? "Market" : "Limit",
        qty: req.quantity.toString(),
        price: req.price ? req.price.toString() : undefined,
        orderLinkId: req.clientOrderId || `PH-${Date.now()}`,
      });

      const signString = timestamp + creds.apiKey + recvWindow + body;
      const signature = await signHmacSha256(signString, creds.apiSecret);

      const res = await fetch("https://api.bybit.com/v5/order/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BAPI-API-KEY": creds.apiKey,
          "X-BAPI-TIMESTAMP": timestamp,
          "X-BAPI-SIGN": signature,
          "X-BAPI-RECV-WINDOW": recvWindow,
        },
        body,
      });

      const data = await res.json();
      if (data.retCode !== 0) {
        throw new Error(`Bybit order error: ${data.retMsg || "Unknown error"}`);
      }

      return {
        orderId: data.result?.orderId || "BYB-ORD",
        symbol: req.symbol,
        status: "NEW",
        executedQty: 0,
        price: req.price || 0,
        rawResponse: data,
      };
    }

    if (this.exchangeId === "okx") {
      const timestamp = new Date().toISOString();
      const method = "POST";
      const requestPath = "/api/v5/trade/order";
      const okxSym = req.symbol.endsWith("USDT") ? `${req.symbol.replace("USDT", "")}-USDT` : req.symbol;
      const body = JSON.stringify({
        instId: okxSym,
        tdMode: "cash",
        side: req.side.toLowerCase(),
        ordType: req.type.toLowerCase(),
        sz: req.quantity.toString(),
        px: req.price ? req.price.toString() : undefined,
        clOrdId: (req.clientOrderId || `PH${Date.now()}`).slice(0, 32),
      });

      const signString = timestamp + method + requestPath + body;
      const signature = await signHmacSha256Base64(signString, creds.apiSecret);

      const res = await fetch(`https://www.okx.com${requestPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OK-ACCESS-KEY": creds.apiKey,
          "OK-ACCESS-SIGN": signature,
          "OK-ACCESS-TIMESTAMP": timestamp,
          "OK-ACCESS-PASSPHRASE": creds.passphrase || "",
        },
        body,
      });

      const data = await res.json();
      if (data.code !== "0") {
        throw new Error(`OKX order error: ${data.msg || "Unknown error"}`);
      }

      const ord = data.data?.[0];
      return {
        orderId: ord?.ordId || "OKX-ORD",
        symbol: req.symbol,
        status: "NEW",
        executedQty: 0,
        price: req.price || 0,
        rawResponse: data,
      };
    }

    throw new Error(`Order execution not implemented for ${this.exchangeId}`);
  }
}

/**
 * Web Crypto HMAC-SHA256 Hex Generator
 */
export async function signHmacSha256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Web Crypto HMAC-SHA256 Base64 Generator (Required by OKX)
 */
export async function signHmacSha256Base64(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const uint8 = new Uint8Array(signature);
  let binary = "";
  for (let i = 0; i < uint8.byteLength; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
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
