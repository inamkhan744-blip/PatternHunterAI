/**
 * Multi-Exchange Architecture Service
 * Supports unified management and connectivity for tier-1 crypto exchanges:
 * - Binance (Spot & USDⓈ-M Futures)
 * - Bybit (v5 Unified Trading API)
 * - KuCoin (v1 / v2 Market & Trade API)
 * - OKX (v5 Unified Account API)
 *
 * Encrypts and securely stores user API credentials using AES-256 via CryptoSecurity.
 */

import { encryptData, decryptData } from "./CryptoSecurity";

export type ExchangeId = "binance" | "bybit" | "kucoin" | "okx";

export interface ExchangeConfig {
  id: ExchangeId;
  name: string;
  iconText: string;
  color: string;
  description: string;
  requiresPassphrase?: boolean;
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string; // KuCoin & OKX require an API Passphrase
  testnet?: boolean;
}

export const SUPPORTED_EXCHANGES: ExchangeConfig[] = [
  {
    id: "binance",
    name: "Binance",
    iconText: "BNB",
    color: "#F3BA2F",
    description: "World's largest crypto exchange by volume (Spot & USDⓈ-M Futures)",
    requiresPassphrase: false,
  },
  {
    id: "bybit",
    name: "Bybit",
    iconText: "BYB",
    color: "#F7A600",
    description: "Leading derivative & inverse perpetual trading exchange (v5 Unified API)",
    requiresPassphrase: false,
  },
  {
    id: "okx",
    name: "OKX",
    iconText: "OKX",
    color: "#FFFFFF",
    description: "Institutional multi-currency margin & futures trading platform (v5 API)",
    requiresPassphrase: true,
  },
  {
    id: "kucoin",
    name: "KuCoin",
    iconText: "KCS",
    color: "#24AE8F",
    description: "Top altcoin exchange with deep liquidity and spot/margin pairs",
    requiresPassphrase: true,
  },
];

const STORAGE_KEY_ACTIVE_EXCHANGE = "fortress_active_exchange";
const STORAGE_KEY_EXCHANGE_KEYS_PREFIX = "fortress_exchange_creds_";

/**
 * Gets currently active exchange
 */
export function getActiveExchange(): ExchangeId {
  if (typeof localStorage === "undefined") return "binance";
  const stored = localStorage.getItem(STORAGE_KEY_ACTIVE_EXCHANGE);
  if (stored && (stored === "binance" || stored === "bybit" || stored === "kucoin" || stored === "okx")) {
    return stored as ExchangeId;
  }
  return "binance";
}

/**
 * Sets active exchange
 */
export function setActiveExchange(exchangeId: ExchangeId): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY_ACTIVE_EXCHANGE, exchangeId);
  }
}

/**
 * Securely stores encrypted credentials for a specific exchange
 */
export function saveExchangeCredentials(
  exchangeId: ExchangeId,
  credentials: ExchangeCredentials
): void {
  if (typeof localStorage === "undefined") return;
  const serialized = JSON.stringify(credentials);
  const encrypted = encryptData(serialized);
  localStorage.setItem(`${STORAGE_KEY_EXCHANGE_KEYS_PREFIX}${exchangeId}`, encrypted);
}

/**
 * Decrypts and retrieves credentials for a specific exchange
 */
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

/**
 * Checks if exchange has active credentials configured
 */
export function isExchangeConnected(exchangeId: ExchangeId): boolean {
  const creds = getExchangeCredentials(exchangeId);
  return Boolean(creds.apiKey.trim() && creds.apiSecret.trim());
}

/**
 * Pings public endpoint of target exchange to test latency and connectivity
 */
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
