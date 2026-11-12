/**
 * Server-side Binance helpers for the 24/7 Auto-Pilot worker.
 *
 * - Public market data (klines, ticker) needs no credentials.
 * - Signed requests use HMAC-SHA256 over the exact query string and an explicit
 *   allow-list of trading endpoints, so a malformed call can never reach an
 *   arbitrary Binance route. Keys are decrypted by the caller and never logged.
 */

import { hmacSha256Hex } from "./security.ts";

export type MarketTarget = "spot" | "futures";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const SPOT_BASE = "https://api.binance.com";
const FUTURES_BASE = "https://fapi.binance.com";
const REQUEST_TIMEOUT_MS = 10_000;

/** Trading/account endpoints the worker is allowed to sign. */
const ALLOWED_ENDPOINTS: Record<MarketTarget, string[]> = {
  spot: ["/api/v3/account", "/api/v3/order", "/api/v3/orderList/oco", "/api/v3/openOrders"],
  futures: [
    "/fapi/v2/balance",
    "/fapi/v2/positionRisk",
    "/fapi/v1/order",
    "/fapi/v1/openOrders",
    "/fapi/v1/leverage",
  ],
};

function isAllowed(target: MarketTarget, path: string): boolean {
  if (!/^\/[A-Za-z0-9/_\-.]{1,80}$/.test(path) || path.includes("..")) return false;
  return ALLOWED_ENDPOINTS[target].some((allowed) => path === allowed || path.startsWith(`${allowed}/`));
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseKlines(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  const candles: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const candle: Candle = {
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    };
    if (Object.values(candle).every((v) => Number.isFinite(v))) candles.push(candle);
  }
  return candles;
}

/** Public klines. `interval` is a Binance interval such as 1h / 4h / 15m. */
export async function fetchKlines(symbol: string, interval: string, limit = 200): Promise<Candle[]> {
  const url = `${SPOT_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(
    interval
  )}&limit=${Math.min(Math.max(limit, 30), 500)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Klines request failed (${res.status})`);
  return parseKlines(await res.json());
}

export async function fetchTickerPrice(symbol: string): Promise<number | null> {
  const res = await fetchWithTimeout(`${SPOT_BASE}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { price?: string };
  const price = Number(body.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export interface SignedRequest {
  target: MarketTarget;
  method: "GET" | "POST" | "DELETE";
  path: string;
  params?: Record<string, string | number | boolean>;
}

/**
 * Signs and sends one authenticated Binance request.
 * Returns the parsed JSON body and the HTTP status; never throws on an exchange
 * error (the worker logs it and moves on).
 */
export async function binanceSigned(
  apiKey: string,
  apiSecret: string,
  request: SignedRequest
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null; error?: string }> {
  if (!isAllowed(request.target, request.path)) {
    return { ok: false, status: 400, data: null, error: "Endpoint not allowed" };
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(request.params ?? {})) {
    params.set(key, String(value));
  }
  params.set("timestamp", String(Date.now()));
  params.set("recvWindow", "5000");

  const payload = params.toString();
  const signature = await hmacSha256Hex(apiSecret, payload);
  const signed = `${payload}&signature=${signature}`;

  const base = request.target === "futures" ? FUTURES_BASE : SPOT_BASE;
  const headers: Record<string, string> = { Accept: "application/json", "X-MBX-APIKEY": apiKey };
  let url = `${base}${request.path}`;
  let body: string | undefined;
  if (request.method === "GET" || request.method === "DELETE") {
    url = `${url}?${signed}`;
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = signed;
  }

  try {
    const res = await fetchWithTimeout(url, { method: request.method, headers, body });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message =
        data && typeof data === "object" && "msg" in data ? String((data as { msg: unknown }).msg) : `HTTP ${res.status}`;
      return { ok: false, status: res.status, data: data as Record<string, unknown> | null, error: message };
    }
    return { ok: true, status: res.status, data: (data as Record<string, unknown> | null) ?? null };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/** Truncates to the given number of decimals without rounding up notional. */
export function floorTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
}
