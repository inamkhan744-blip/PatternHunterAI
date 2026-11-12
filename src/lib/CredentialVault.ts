import { supabase } from "./supabase";

/**
 * Server-side exchange credential vault (client wrapper).
 *
 * Binance API keys are posted once over TLS to the `binance-credentials` edge
 * function, which authenticates the JWT and encrypts them with AES-256-GCM using
 * a key that only exists in Supabase secrets. The browser never receives the
 * secret again, never stores it in localStorage, and never signs requests:
 * `binance-proxy` signs with the decrypted secret server-side.
 *
 * The only thing cached here is non-sensitive status metadata (configured flag,
 * last four characters, update time) for UI badges.
 */

export type VaultExchange = "binance" | "bybit" | "okx" | "kucoin";

export interface CredentialStatus {
  configured: boolean;
  apiKeyLast4: string | null;
  updatedAt: string | null;
}

const EMPTY_STATUS: CredentialStatus = { configured: false, apiKeyLast4: null, updatedAt: null };

let cachedStatus: CredentialStatus = { ...EMPTY_STATUS };

export function getCachedCredentialStatus(): CredentialStatus {
  return cachedStatus;
}

export function clearCredentialCache(): void {
  cachedStatus = { ...EMPTY_STATUS };
}

/** True when encrypted credentials exist server-side for the signed-in user. */
export function isLiveTradingConfigured(): boolean {
  return cachedStatus.configured;
}

export function hasApiKeyLast4(): string | null {
  return cachedStatus.apiKeyLast4;
}

async function callVault<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("binance-credentials", { body });
  if (error) {
    throw new Error(error.message || "Credential vault request failed");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Credential vault returned an empty response");
  }
  const payload = data as Record<string, unknown>;
  if (payload.error) {
    throw new Error(String(payload.error));
  }
  return payload as T;
}

/** Refreshes the cached status from the server. Safe to call on every mount. */
export async function refreshCredentialStatus(exchange: VaultExchange = "binance"): Promise<CredentialStatus> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) {
    cachedStatus = { ...EMPTY_STATUS };
    return cachedStatus;
  }

  try {
    const payload = await callVault<{ status?: CredentialStatus }>({ action: "status", exchange });
    const status = payload.status;
    cachedStatus = {
      configured: status?.configured === true,
      apiKeyLast4: status?.apiKeyLast4 ?? null,
      updatedAt: status?.updatedAt ?? null,
    };
  } catch {
    cachedStatus = { ...EMPTY_STATUS };
  }
  return cachedStatus;
}

/**
 * Stores (or rotates) credentials server-side. The plaintext values are sent only
 * in this request body and are never persisted client-side.
 */
export async function saveExchangeCredentials(params: {
  exchange?: VaultExchange;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}): Promise<CredentialStatus> {
  const exchange = params.exchange ?? "binance";
  const apiKey = params.apiKey.trim();
  const apiSecret = params.apiSecret.trim();

  if (apiKey.length < 8 || apiKey.length > 256) {
    throw new Error("API key length is invalid.");
  }
  if (apiSecret.length < 8 || apiSecret.length > 256) {
    throw new Error("API secret length is invalid.");
  }

  const payload = await callVault<{ status?: CredentialStatus }>({
    action: "save",
    exchange,
    apiKey,
    apiSecret,
    passphrase: params.passphrase?.trim() || undefined,
  });

  cachedStatus = {
    configured: payload.status?.configured === true,
    apiKeyLast4: payload.status?.apiKeyLast4 ?? apiKey.slice(-4),
    updatedAt: payload.status?.updatedAt ?? new Date().toISOString(),
  };
  return cachedStatus;
}

/** Deletes the stored credentials server-side. */
export async function deleteExchangeCredentials(exchange: VaultExchange = "binance"): Promise<void> {
  await callVault({ action: "delete", exchange });
  cachedStatus = { ...EMPTY_STATUS };
}
