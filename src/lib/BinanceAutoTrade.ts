/**
 * Fortress-Level Binance Auto-Trade Execution Engine
 * Supports both Binance Spot API (api.binance.com) and Binance Futures API (fapi.binance.com)
 * Comprehensive risk management: 1-3 Max Open Trades, 1.5x ATR SL, 1:1 Trailing SL,
 * Profit Vault (50% to Spot), Liquidation Price warning, 2-loss Circuit Breaker, Emergency Kill Switch.
 * Enterprise Security: AES-256 encrypted keys and Telegram Bot alerts.
 */

import { isLiveTradingConfigured } from "./CredentialVault";
import { notifyTradeOpened, notifyTradeClosed, sendTelegramAlert } from "./TelegramService";
import { pushNotificationService } from "./PushNotification";
import { checkTradeExecutionAllowance } from "./SubscriptionManager";
import { runRealSwarmDebate, simulateSwarmDebate } from "./AgentSwarm";
import { fetchCandles } from "./binance";
import { rsi } from "./indicators";
import { supabase } from "./supabase";
import { liveWorkerLogStore } from "./LiveWorkerLogStore";

export type MarketType = "Spot" | "Futures";
export type TradeDirection = "LONG" | "SHORT";
export type TradeDirectionMode = "BOTH" | "LONG_ONLY" | "SHORT_ONLY";
export type AutoPilotState = "IDLE" | "ARMED" | "WATCHING" | "PAUSED";

/** Auto-Pilot refuses to trade if price moved more than this from the signal price. */
export const MAX_SLIPPAGE_PCT = 0.2;

/** Mandatory pause after any close, to prevent revenge trading. */
export const AUTOPILOT_COOLDOWN_SECONDS = 30;

export interface AutoTradeConfig {
  apiKey: string;
  apiSecret: string;
  marketType: MarketType;
  leverage: number; // 1 to 10
  direction: TradeDirection; // For futures
  tradeDirectionMode: TradeDirectionMode; // Both (Dynamic), Long Only, Short Only
  riskPercent: number; // e.g. 1% to 5%
  maxOpenTrades: number; // 1 to 3
  profitVaultEnabled: boolean; // Move 50% realized profits to Spot
  atrMultiplier: number; // Default 1.5x
  trailingSlEnabled: boolean; // Move SL to BE at 1:1 RR
  autoPilotEnabled: boolean;
  disclaimerAgreed: boolean;
  paperTradingEnabled: boolean; // Paper mode virtual trading
  maxDailyLossPercent: number; // Max daily loss % (default 3%) before tripping circuit breaker
  allowAiFallback: boolean; // Allow trades if Gemini AI fails (local heuristic fallback)
}

export interface ManagedTrade {
  id: string;
  symbol: string;
  marketType: MarketType;
  direction: TradeDirection;
  leverage: number;
  entryPrice: number;
  quantity: number;
  positionValue: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  initialStopLoss: number;
  trailingSlTriggered: boolean;
  trailingStage?: "INITIAL" | "BREAK_EVEN" | "TRAILING_ATR";
  peakPrice?: number;
  troughPrice?: number;
  atrAtEntry: number;
  liquidationPrice?: number;
  openTime: number;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  closePrice?: number;
  realizedPnl?: number;
  profitVaultAmount?: number;
  orderId?: string;
  slOrderId?: string;
  tpOrderId?: string;
  orderType: "LIMIT" | "MARKET";
  isStuck?: boolean;
  /**
   * Whether this position was actually opened on Binance (REAL) or only simulated
   * locally (PAPER). Every exchange-side action must be gated on this flag so a
   * paper position can never trigger a live order.
   */
  executionMode?: "REAL" | "PAPER";
  slOrderError?: string;
  tpOrderError?: string;
}

export interface CircuitBreakerState {
  consecutiveLosses: number;
  isTripped: boolean;
  trippedAt?: number;
  reason?: string;
}

export interface LiquidationInfo {
  liquidationPrice: number;
  distancePercent: number;
  isWarning: boolean;
  warningMessage?: string;
}

const STORAGE_KEY_CONFIG = "fortress_binance_autotrade_config";
const STORAGE_KEY_TRADES = "fortress_binance_managed_trades";
const STORAGE_KEY_CIRCUIT = "fortress_binance_circuit_breaker";
const STORAGE_KEY_VAULT = "fortress_binance_profit_vault_total";
const STORAGE_KEY_POST_LOSS_COOLDOWN = "fortress_binance_post_loss_cooldown";
const STORAGE_KEY_DAILY_STATS = "fortress_binance_daily_stats";
const STORAGE_KEY_AUTOPILOT_COOLDOWN = "fortress_autopilot_cooldown_until";
const STORAGE_KEY_AUTOPILOT_PAUSE = "fortress_autopilot_pause_reason";

export const DEFAULT_CONFIG: AutoTradeConfig = {
  apiKey: "",
  apiSecret: "",
  marketType: "Spot",
  leverage: 3, // Safe default within 1-10x
  direction: "LONG",
  tradeDirectionMode: "BOTH",
  riskPercent: 1.5,
  maxOpenTrades: 2, // 1 to 3
  profitVaultEnabled: true,
  atrMultiplier: 1.5,
  trailingSlEnabled: true,
  autoPilotEnabled: false,
  disclaimerAgreed: false,
  paperTradingEnabled: false,
  maxDailyLossPercent: 3.0,
  allowAiFallback: true,
};

// Base URLs
export const SPOT_API_BASE = "https://api.binance.com";
export const FUTURES_API_BASE = "https://fapi.binance.com";

/**
 * Proxy fetch helper for Binance REST API requests.
 *
 * SECURITY: the browser never holds Binance API keys and never signs requests.
 * Every call is forwarded to the `binance-proxy` edge function, which verifies the
 * user JWT, decrypts that user's credentials server-side, adds the timestamp and
 * HMAC signature, and enforces the per-user rate limit + endpoint allow-list.
 */
export async function proxyBinanceFetch(options: {
  target: "spot" | "futures";
  path: string;
  method?: "GET" | "POST" | "DELETE" | "PUT";
  query?: string;
  body?: string;
}): Promise<Response> {
  const { target, path, method = "GET", query = "", body } = options;
  const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
  const supabaseUrl = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : "";

  if (isBrowser && supabaseUrl && !supabaseUrl.includes("placeholder")) {
    const { data: sessionData } = await supabase.auth.getSession();
    const authToken = sessionData?.session?.access_token;
    if (authToken) {
      return fetch(`${supabaseUrl}/functions/v1/binance-proxy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ target, path, method, query, body }),
      });
    }
  }

  // Unsigned public-endpoint fallback (no credentials involved). Private endpoints
  // return 401 from Binance, which is the correct fail-closed behaviour.
  const baseUrl = target === "futures" ? FUTURES_API_BASE : SPOT_API_BASE;
  const fullUrl = query ? `${baseUrl}${path}?${query}` : `${baseUrl}${path}`;
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";

  return fetch(fullUrl, {
    method,
    headers,
    ...(body ? { body } : {}),
  });
}

/**
 * Calculates position size auto-compounded based on risk percent, account balance, and leverage.
 */
export function calculatePositionSize(
  riskPercent: number,
  accountBalance: number,
  leverage: number = 1,
  entryPrice: number = 1,
  stopLossPrice?: number
): { quantity: number; positionValue: number; marginRequired: number } {
  if (accountBalance <= 0 || riskPercent <= 0 || entryPrice <= 0) {
    return { quantity: 0, positionValue: 0, marginRequired: 0 };
  }

  const effectiveLeverage = Math.max(1, Math.min(10, leverage));
  const clampedRisk = Math.max(0.1, Math.min(100, riskPercent));

  // Risk-based sizing: `riskPercent` is the maximum equity loss if the stop is hit,
  // so notional = riskAmount / stopDistance * entry. When no stop is supplied we
  // fall back to allocating `riskPercent` of equity as margin (legacy behaviour).
  const stopDistance = stopLossPrice && stopLossPrice > 0 ? Math.abs(entryPrice - stopLossPrice) : 0;

  let marginRequired: number;
  let positionValue: number;

  if (stopDistance > 0 && stopDistance < entryPrice) {
    const riskAmount = accountBalance * (clampedRisk / 100);
    const riskBasedNotional = (riskAmount / stopDistance) * entryPrice;
    // Never exceed the maximum notional the account can collateralise.
    const maxNotional = accountBalance * effectiveLeverage;
    positionValue = Math.min(riskBasedNotional, maxNotional);
    marginRequired = positionValue / effectiveLeverage;
  } else {
    marginRequired = accountBalance * (clampedRisk / 100);
    positionValue = marginRequired * effectiveLeverage;
  }

  const quantity = positionValue / entryPrice;

  return {
    quantity: Number(quantity.toFixed(6)),
    positionValue: Number(positionValue.toFixed(2)),
    marginRequired: Number(marginRequired.toFixed(2)),
  };
}

/**
 * Calculates theoretical Liquidation Price for Binance USDT-M Futures.
 */
export function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  direction: TradeDirection,
  mmr: number = 0.005
): LiquidationInfo {
  if (entryPrice <= 0 || leverage <= 0) {
    return { liquidationPrice: 0, distancePercent: 0, isWarning: false };
  }

  const lev = Math.max(1, Math.min(125, leverage));
  const safeMmr = Math.max(0, Math.min(0.2, mmr));
  let liqPrice = 0;

  // Binance USDT-M isolated approximation: the maintenance-margin rate applies to
  // the notional, i.e. it is divided by leverage in entry-price terms:
  //   LONG : liq = entry * (1 - 1/L + mmr/L)
  //   SHORT: liq = entry * (1 + 1/L - mmr/L)
  // (The previous formula added the full mmr to the price, understating the distance.)
  if (direction === "LONG") {
    liqPrice = entryPrice * (1 - (1 / lev) + (safeMmr / lev));
    liqPrice = Math.max(0, liqPrice);
  } else {
    liqPrice = entryPrice * (1 + (1 / lev) - (safeMmr / lev));
  }

  const distancePercent = Math.abs((liqPrice - entryPrice) / entryPrice) * 100;

  return {
    liquidationPrice: Number(liqPrice.toFixed(4)),
    distancePercent: Number(distancePercent.toFixed(2)),
    isWarning: false,
  };
}

/**
 * Evaluates whether Stop Loss is dangerously close to or beyond Liquidation Price.
 */
export function checkLiquidationProximity(
  stopLossPrice: number,
  liquidationPrice: number,
  direction: TradeDirection,
  entryPrice: number
): { isTooClose: boolean; warningMessage?: string; distanceToLiqPct: number } {
  if (liquidationPrice <= 0 || stopLossPrice <= 0 || entryPrice <= 0) {
    return { isTooClose: false, distanceToLiqPct: 0 };
  }

  let isTooClose = false;
  let distanceToLiqPct = 0;

  if (direction === "LONG") {
    if (stopLossPrice <= liquidationPrice) {
      return {
        isTooClose: true,
        warningMessage: "CRITICAL: Stop Loss is below or at Liquidation Price! Position will liquidate before SL triggers.",
        distanceToLiqPct: 0,
      };
    }
    distanceToLiqPct = ((stopLossPrice - liquidationPrice) / liquidationPrice) * 100;
  } else {
    if (stopLossPrice >= liquidationPrice) {
      return {
        isTooClose: true,
        warningMessage: "CRITICAL: Stop Loss is above or at Liquidation Price! Position will liquidate before SL triggers.",
        distanceToLiqPct: 0,
      };
    }
    distanceToLiqPct = ((liquidationPrice - stopLossPrice) / liquidationPrice) * 100;
  }

  if (distanceToLiqPct < 2.0) {
    isTooClose = true;
    return {
      isTooClose,
      warningMessage: `WARNING: Stop Loss is within ${distanceToLiqPct.toFixed(2)}% of Liquidation Price! High liquidation risk during wicks.`,
      distanceToLiqPct: Number(distanceToLiqPct.toFixed(2)),
    };
  }

  return {
    isTooClose: false,
    distanceToLiqPct: Number(distanceToLiqPct.toFixed(2)),
  };
}

/**
 * Calculates ATR-based Stop Loss and Take Profit.
 */
export function calculateAtrStopLoss(
  entryPrice: number,
  atrValue: number,
  direction: TradeDirection = "LONG",
  atrMultiplier: number = 1.5,
  riskRewardRatio: number = 2.0
): { stopLossPrice: number; takeProfitPrice: number; slDistance: number } {
  const safeAtr = atrValue > 0 ? atrValue : entryPrice * 0.015;
  const slDistance = safeAtr * atrMultiplier;

  let stopLossPrice = 0;
  let takeProfitPrice = 0;

  if (direction === "LONG") {
    stopLossPrice = Math.max(0, entryPrice - slDistance);
    takeProfitPrice = entryPrice + (slDistance * riskRewardRatio);
  } else {
    stopLossPrice = entryPrice + slDistance;
    takeProfitPrice = Math.max(0, entryPrice - (slDistance * riskRewardRatio));
  }

  return {
    stopLossPrice: Number(stopLossPrice.toFixed(4)),
    takeProfitPrice: Number(takeProfitPrice.toFixed(4)),
    slDistance: Number(slDistance.toFixed(4)),
  };
}

/**
 * Trailing Stop Loss Logic: Moves SL to break-even at 1:1 RR.
 */
export function evaluateTrailingStopLoss(
  currentPrice: number,
  trade: ManagedTrade
): {
  shouldUpdateSl: boolean;
  newStopLoss: number;
  newTrailingStage?: "BREAK_EVEN" | "TRAILING_ATR";
  newPeak?: number;
  newTrough?: number;
  reason?: string;
} {
  if (!trade || trade.status !== "OPEN") {
    return { shouldUpdateSl: false, newStopLoss: trade.stopLossPrice };
  }

  const initialRisk = Math.abs(trade.entryPrice - trade.initialStopLoss);
  if (initialRisk <= 0) {
    return { shouldUpdateSl: false, newStopLoss: trade.stopLossPrice };
  }

  const safeAtr = trade.atrAtEntry > 0 ? trade.atrAtEntry : trade.entryPrice * 0.015;
  const trailDistance = 1.5 * safeAtr;

  if (trade.direction === "LONG") {
    const currentPeak = Math.max(trade.peakPrice ?? trade.entryPrice, currentPrice);
    const currentReward = currentPrice - trade.entryPrice;

    // Check if 1:1 RR reached
    if (currentReward >= initialRisk) {
      // Once break-even reached, also check dynamic 1.5x ATR trailing from peak
      const dynamicTrailSl = currentPeak - trailDistance;
      // Stop loss should be at least break-even (entryPrice), and trail up if dynamicTrailSl > entryPrice
      const targetSl = Math.max(trade.entryPrice, dynamicTrailSl);

      if (targetSl > trade.stopLossPrice) {
        const stage = targetSl > trade.entryPrice ? "TRAILING_ATR" : "BREAK_EVEN";
        const reason =
          stage === "TRAILING_ATR"
            ? `Price reached peak $${currentPeak.toFixed(2)}. SL trailed by 1.5x ATR to $${targetSl.toFixed(2)}.`
            : "1:1 RR target achieved. Stop Loss moved to Break-Even (Entry Price).";

        return {
          shouldUpdateSl: true,
          newStopLoss: Number(targetSl.toFixed(4)),
          newTrailingStage: stage,
          newPeak: currentPeak,
          reason,
        };
      }
    }
  } else {
    // SHORT direction
    const currentTrough = Math.min(trade.troughPrice ?? trade.entryPrice, currentPrice);
    const currentReward = trade.entryPrice - currentPrice;

    // Check if 1:1 RR reached
    if (currentReward >= initialRisk) {
      const dynamicTrailSl = currentTrough + trailDistance;
      // Stop loss should be at least break-even (entryPrice), and trail down if dynamicTrailSl < entryPrice
      const targetSl = Math.min(trade.entryPrice, dynamicTrailSl);

      if (targetSl < trade.stopLossPrice) {
        const stage = targetSl < trade.entryPrice ? "TRAILING_ATR" : "BREAK_EVEN";
        const reason =
          stage === "TRAILING_ATR"
            ? `Price reached trough $${currentTrough.toFixed(2)}. SL trailed by 1.5x ATR to $${targetSl.toFixed(2)}.`
            : "1:1 RR target achieved. Stop Loss moved to Break-Even (Entry Price).";

        return {
          shouldUpdateSl: true,
          newStopLoss: Number(targetSl.toFixed(4)),
          newTrailingStage: stage,
          newTrough: currentTrough,
          reason,
        };
      }
    }
  }

  return { shouldUpdateSl: false, newStopLoss: trade.stopLossPrice };
}

/**
 * Signs query string or body using HMAC SHA-256 for private Binance endpoints.
 */
export async function signQuery(queryString: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(queryString));
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface DailyTradeStats {
  date: string; // YYYY-MM-DD
  startingBalance: number;
  realizedPnlToday: number;
  /** Executions opened today (persisted so a refresh cannot reset the count). */
  tradesOpened: number;
}

export class BinanceAutoTradeEngine {
  private config: AutoTradeConfig;
  private trades: ManagedTrade[] = [];
  private autoPilotState: AutoPilotState = "IDLE";
  private circuitBreaker: CircuitBreakerState = {
    consecutiveLosses: 0,
    isTripped: false,
  };
  private profitVaultTotal: number = 0;
  private postLossCooldownUntil: number = 0;
  private dailyStats: DailyTradeStats = {
    date: new Date().toISOString().slice(0, 10),
    startingBalance: 10000,
    realizedPnlToday: 0,
    tradesOpened: 0,
  };
  private autoPilotCooldownUntil: number = 0;
  private autoPilotPauseReason: string | null = null;

  constructor() {
    this.config = this.loadConfig();
    this.trades = this.loadTrades();
    this.circuitBreaker = this.loadCircuitBreaker();
    this.profitVaultTotal = this.loadProfitVault();
    this.postLossCooldownUntil = this.loadPostLossCooldown();
    this.dailyStats = this.loadDailyStats();
    this.autoPilotCooldownUntil = this.loadAutoPilotCooldown();
    this.autoPilotPauseReason = this.loadPauseReason();

    if (this.autoPilotPauseReason && this.config.autoPilotEnabled) {
      // A paused Auto-Pilot must stay paused across reloads until the user re-arms it.
      this.config.autoPilotEnabled = false;
      this.saveConfig({ autoPilotEnabled: false });
    }

    if (this.config.autoPilotEnabled) {
      // Enabled but not executing: ARMED waits for the next candle close.
      this.autoPilotState = "ARMED";
    }
  }

  public getAutoPilotState(): AutoPilotState {
    return this.autoPilotState;
  }

  public setAutoPilotState(state: AutoPilotState): void {
    this.autoPilotState = state;
  }

  public getAutoPilotPauseReason(): string | null {
    return this.autoPilotPauseReason;
  }

  // --- Persistence ---
  public loadConfig(): AutoTradeConfig {
    let baseConfig = { ...DEFAULT_CONFIG };
    if (typeof localStorage !== "undefined") {
      try {
        const stored = localStorage.getItem(STORAGE_KEY_CONFIG);
        if (stored) {
          baseConfig = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
        }
      } catch {
        // fallback
      }
    }

    // Credentials are never hydrated into the browser. They live only in the
    // server-side vault and are consumed by the `binance-proxy` edge function.
    baseConfig.apiKey = "";
    baseConfig.apiSecret = "";

    return baseConfig;
  }

  public saveConfig(configUpdates: Partial<AutoTradeConfig>): AutoTradeConfig {
    // Check if Auto-Pilot is being toggled ON
    const wasAutoPilotEnabled = this.config.autoPilotEnabled;
    const isEnablingAutoPilot = configUpdates.autoPilotEnabled === true && !wasAutoPilotEnabled;

    if (isEnablingAutoPilot) {
      // ARMED never trades immediately: the App loop must wait for a candle that
      // closes *after* arming, then pass the AI + confluence gates.
      this.autoPilotState = "ARMED";
      this.autoPilotPauseReason = null;
      this.savePauseReason(null);
      liveWorkerLogStore.addLog(
        "Auto-Pilot Armed. Waiting for a fresh candle close before evaluating any signal.",
        "info"
      );
    } else if (configUpdates.autoPilotEnabled === false) {
      this.autoPilotState = "IDLE";
      liveWorkerLogStore.addLog("Auto-Pilot Disarmed. Scanning halted.", "info");
    }

    // Any apiKey/apiSecret in the patch is discarded: secrets are written only by
    // the CredentialVault to the server-side vault, never to engine state/localStorage.
    this.config = { ...this.config, ...configUpdates, apiKey: "", apiSecret: "" };
    this.config.leverage = Math.max(1, Math.min(10, this.config.leverage));
    this.config.maxOpenTrades = Math.max(1, Math.min(3, this.config.maxOpenTrades));

    if (typeof localStorage !== "undefined") {
      // Store config without raw keys in plain storage
      const safeStorageConfig = { ...this.config, apiKey: "", apiSecret: "" };
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(safeStorageConfig));
    }

    return this.config;
  }

  public getConfig(): AutoTradeConfig {
    return { ...this.config };
  }

  private loadTrades(): ManagedTrade[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_TRADES);
      if (stored) {
        const parsed = JSON.parse(stored) as ManagedTrade[];
        // Legacy records predate executionMode. Anything with a SIM- order id (or
        // no order id at all) was simulated, so it must never trigger a live close.
        return parsed.map((t) => ({
          ...t,
          executionMode:
            t.executionMode ?? (t.orderId && !String(t.orderId).startsWith("SIM-") ? "REAL" : "PAPER"),
        }));
      }
    } catch {
      // fallback
    }
    return [];
  }

  private saveTrades(): void {
    localStorage.setItem(STORAGE_KEY_TRADES, JSON.stringify(this.trades));
  }

  public getOpenTrades(): ManagedTrade[] {
    return this.trades.filter((t) => t.status === "OPEN");
  }

  public getAllTrades(): ManagedTrade[] {
    return [...this.trades];
  }

  public checkStuckTrades(timeoutMs: number = 24 * 60 * 60 * 1000): ManagedTrade[] {
    const now = Date.now();
    const stuck: ManagedTrade[] = [];
    let updated = false;

    for (const trade of this.trades) {
      if (trade.status === "OPEN" && now - trade.openTime > timeoutMs) {
        if (!trade.isStuck) {
          trade.isStuck = true;
          const openHours = ((now - trade.openTime) / (1000 * 60 * 60)).toFixed(1);
          console.warn(`[STUCK TRADE TIMEOUT] Position for ${trade.symbol} (ID: ${trade.id}) has been open for ${openHours}h without hitting SL/TP. Allowing scanner to seek new trades on other symbols.`);
          updated = true;
        }
        stuck.push(trade);
      }
    }

    if (updated) {
      this.saveTrades();
    }
    return stuck;
  }

  private loadCircuitBreaker(): CircuitBreakerState {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CIRCUIT);
      if (stored) return JSON.parse(stored);
    } catch {
      // fallback
    }
    return { consecutiveLosses: 0, isTripped: false };
  }

  private saveCircuitBreaker(): void {
    localStorage.setItem(STORAGE_KEY_CIRCUIT, JSON.stringify(this.circuitBreaker));
  }

  public getCircuitBreaker(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  public resetCircuitBreaker(): void {
    this.circuitBreaker = {
      consecutiveLosses: 0,
      isTripped: false,
    };
    this.saveCircuitBreaker();
  }

  public tripCircuitBreaker(reason: string = "Admin manual circuit breaker trip"): void {
    this.circuitBreaker.isTripped = true;
    this.circuitBreaker.trippedAt = Date.now();
    this.circuitBreaker.reason = reason;
    this.saveCircuitBreaker();
  }

  // --- Post-Loss Cooldown (30 Minutes) ---
  private loadPostLossCooldown(): number {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_POST_LOSS_COOLDOWN);
      if (stored) return parseInt(stored, 10) || 0;
    } catch {
      // fallback
    }
    return 0;
  }

  private savePostLossCooldown(untilTimestamp: number): void {
    this.postLossCooldownUntil = untilTimestamp;
    localStorage.setItem(STORAGE_KEY_POST_LOSS_COOLDOWN, String(untilTimestamp));
  }

  public getPostLossCooldown(): { isActive: boolean; remainingSeconds: number; untilTimestamp: number } {
    const now = Date.now();
    if (this.postLossCooldownUntil > now) {
      return {
        isActive: true,
        remainingSeconds: Math.ceil((this.postLossCooldownUntil - now) / 1000),
        untilTimestamp: this.postLossCooldownUntil,
      };
    }
    return { isActive: false, remainingSeconds: 0, untilTimestamp: 0 };
  }

  public clearPostLossCooldown(): void {
    this.savePostLossCooldown(0);
  }

  // --- Auto-Pilot Revenge-Trading Cooldown (30 seconds after ANY close) ---
  private loadAutoPilotCooldown(): number {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_AUTOPILOT_COOLDOWN);
      if (stored) return parseInt(stored, 10) || 0;
    } catch {
      // fallback
    }
    return 0;
  }

  private saveAutoPilotCooldown(untilTimestamp: number): void {
    this.autoPilotCooldownUntil = untilTimestamp;
    try {
      localStorage.setItem(STORAGE_KEY_AUTOPILOT_COOLDOWN, String(untilTimestamp));
    } catch {
      // ignore quota / private mode
    }
  }

  private loadPauseReason(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY_AUTOPILOT_PAUSE);
    } catch {
      return null;
    }
  }

  private savePauseReason(reason: string | null): void {
    this.autoPilotPauseReason = reason;
    try {
      if (reason) localStorage.setItem(STORAGE_KEY_AUTOPILOT_PAUSE, reason);
      else localStorage.removeItem(STORAGE_KEY_AUTOPILOT_PAUSE);
    } catch {
      // ignore
    }
  }

  public startAutoPilotCooldown(seconds: number = AUTOPILOT_COOLDOWN_SECONDS): void {
    this.saveAutoPilotCooldown(Date.now() + Math.max(1, seconds) * 1000);
    liveWorkerLogStore.addLog(
      `Cooldown active: Preventing revenge trading. (${Math.round(seconds)}s) — no new Auto-Pilot entries.`,
      "warn"
    );
  }

  public getAutoPilotCooldown(): { isActive: boolean; remainingSeconds: number; untilTimestamp: number } {
    const now = Date.now();
    if (this.autoPilotCooldownUntil > now) {
      return {
        isActive: true,
        remainingSeconds: Math.ceil((this.autoPilotCooldownUntil - now) / 1000),
        untilTimestamp: this.autoPilotCooldownUntil,
      };
    }
    return { isActive: false, remainingSeconds: 0, untilTimestamp: 0 };
  }

  public clearAutoPilotCooldown(): void {
    this.saveAutoPilotCooldown(0);
  }

  /**
   * Halts Auto-Pilot immediately. Used when the AI layer is unavailable: the engine
   * must never fall back to heuristic execution without AI confirmation.
   */
  public pauseAutoPilot(reason: string): void {
    if (this.config.autoPilotEnabled) {
      this.config.autoPilotEnabled = false;
      this.saveConfig({ autoPilotEnabled: false });
    }
    this.autoPilotState = "PAUSED";
    this.savePauseReason(reason);
    liveWorkerLogStore.addLog(`Auto-Pilot Paused: ${reason}`, "error");
  }

  public resumeAutoPilot(): AutoTradeConfig {
    this.savePauseReason(null);
    return this.saveConfig({ autoPilotEnabled: true });
  }

  public getAutoPilotSnapshot(): {
    enabled: boolean;
    state: AutoPilotState;
    pauseReason: string | null;
    cooldownSeconds: number;
    tradesToday: number;
  } {
    return {
      enabled: this.config.autoPilotEnabled,
      state: this.autoPilotState,
      pauseReason: this.autoPilotPauseReason,
      cooldownSeconds: this.getAutoPilotCooldown().remainingSeconds,
      tradesToday: this.getDailyTradeCount(),
    };
  }

  /**
   * The Auto-Pilot "brain". Requires a REAL AI verdict built from fresh market data.
   * If Gemini is unavailable, times out, or returns a fallback/malformed result the
   * Auto-Pilot pauses itself instead of trading on a local heuristic.
   */
  public async evaluateAutoPilotSignal(params: {
    symbol: string;
    price: number;
    rsi?: number | null;
    trend?: string | null;
    patternName?: string | null;
    patternDirection?: "bullish" | "bearish" | null;
    fearGreed?: number | null;
    atrValue?: number | null;
    dataTimestamp: number;
    minScore?: number;
  }): Promise<{
    proceed: boolean;
    direction: TradeDirection;
    score: number;
    reason: string;
  }> {
    const minScore = params.minScore ?? 85;
    const fallbackDirection: TradeDirection = params.patternDirection === "bearish" ? "SHORT" : "LONG";

    if (!this.config.autoPilotEnabled || this.autoPilotState === "PAUSED") {
      return { proceed: false, direction: fallbackDirection, score: 0, reason: "Auto-Pilot is not armed" };
    }

    const cooldown = this.getAutoPilotCooldown();
    if (cooldown.isActive) {
      liveWorkerLogStore.addLog(
        `Cooldown active: Preventing revenge trading. (${cooldown.remainingSeconds}s remaining)`,
        "warn",
        { symbol: params.symbol }
      );
      return { proceed: false, direction: fallbackDirection, score: 0, reason: "Cooldown active" };
    }

    const verdict = await runRealSwarmDebate({
      symbol: params.symbol,
      price: params.price,
      rsi: params.rsi ?? null,
      trend: params.trend ?? null,
      patternName: params.patternName ?? null,
      patternDirection: params.patternDirection ?? null,
      fearGreed: params.fearGreed ?? null,
      atrValue: params.atrValue ?? null,
      dataTimestamp: params.dataTimestamp,
    });

    if (verdict.isFallback || !verdict.isRealAI) {
      this.pauseAutoPilot("AI Engine Offline");
      return {
        proceed: false,
        direction: fallbackDirection,
        score: verdict.confluenceScore,
        reason: "AI Engine Offline",
      };
    }

    if (verdict.verdict !== "GO" || verdict.confluenceScore < minScore) {
      liveWorkerLogStore.addLog(
        `Signal Found (Score ${verdict.confluenceScore}/${minScore}) - Skipping`,
        "info",
        { symbol: params.symbol, confluence: verdict.confluenceScore }
      );
      return {
        proceed: false,
        direction: fallbackDirection,
        score: verdict.confluenceScore,
        reason: verdict.verdictReason,
      };
    }

    // Direction is AI-recommended when valid, otherwise the detected pattern decides.
    const direction: TradeDirection =
      verdict.recommendedDirection === "LONG" || verdict.recommendedDirection === "SHORT"
        ? verdict.recommendedDirection
        : fallbackDirection;

    return {
      proceed: true,
      direction,
      score: verdict.confluenceScore,
      reason: verdict.verdictReason,
    };
  }

  // --- Daily Drawdown Tracking ---
  private loadDailyStats(): DailyTradeStats {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const stored = localStorage.getItem(STORAGE_KEY_DAILY_STATS);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.date === today) {
          return { ...parsed, tradesOpened: Number(parsed.tradesOpened) || 0 };
        }
      }
    } catch {
      // fallback
    }
    return {
      date: today,
      startingBalance: 10000,
      realizedPnlToday: 0,
      tradesOpened: 0,
    };
  }

  public getDailyTradeCount(): number {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyStats.date !== today) {
      this.dailyStats = { date: today, startingBalance: 10000, realizedPnlToday: 0, tradesOpened: 0 };
      this.saveDailyStats();
    }
    return this.dailyStats.tradesOpened;
  }

  private saveDailyStats(): void {
    localStorage.setItem(STORAGE_KEY_DAILY_STATS, JSON.stringify(this.dailyStats));
  }

  public getDailyDrawdown(): {
    realizedPnlToday: number;
    drawdownPct: number;
    maxDailyLossPercent: number;
    startingBalance: number;
  } {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyStats.date !== today) {
      this.dailyStats = {
        date: today,
        startingBalance: 10000,
        realizedPnlToday: 0,
        tradesOpened: 0,
      };
      this.saveDailyStats();
    }

    const startBal = this.dailyStats.startingBalance > 0 ? this.dailyStats.startingBalance : 10000;
    const lossAmount = Math.min(0, this.dailyStats.realizedPnlToday);
    const drawdownPct = Math.abs(lossAmount / startBal) * 100;

    return {
      realizedPnlToday: this.dailyStats.realizedPnlToday,
      drawdownPct: Number(drawdownPct.toFixed(2)),
      maxDailyLossPercent: this.config.maxDailyLossPercent ?? 3.0,
      startingBalance: startBal,
    };
  }

  // --- Dynamic Confluence Scaling ---
  public getRequiredConfluenceScore(entryPrice: number, atrValue: number): {
    requiredScore: number;
    atrPercent: number;
    isHighVolatility: boolean;
  } {
    const atrPercent = entryPrice > 0 ? (atrValue / entryPrice) * 100 : 0;
    // If ATR > 2.0% of price, market is high volatility: dynamically scale required score to 95+
    const isHighVolatility = atrPercent >= 2.0;
    const requiredScore = isHighVolatility ? 95 : 85;

    return {
      requiredScore,
      atrPercent: Number(atrPercent.toFixed(2)),
      isHighVolatility,
    };
  }

  // --- Global Market Filter: BTC 1H Trend & RSI Check ---
  public async checkBtcMarketFilter(direction: TradeDirection, symbol: string): Promise<{
    allowed: boolean;
    btcH1Rsi?: number;
    reason?: string;
  }> {
    // If trade is on BTC itself, or trade is SHORT, filter does not block
    if (symbol.toUpperCase().startsWith("BTC") || direction === "SHORT") {
      return { allowed: true };
    }

    try {
      const btcCandles = await fetchCandles("BTCUSDT", 30, "1h");
      if (btcCandles.length < 15) {
        return { allowed: true };
      }
      const closes = btcCandles.map((c) => c.close);
      const rsiValues = rsi(closes, 14);
      const btcH1Rsi = rsiValues[rsiValues.length - 1];

      if (btcH1Rsi !== null && btcH1Rsi < 30) {
        return {
          allowed: false,
          btcH1Rsi: Number(btcH1Rsi.toFixed(1)),
          reason: `GLOBAL MARKET VETO: BTC 1H RSI is dumping at ${btcH1Rsi.toFixed(1)} (<30). All Altcoin LONG trades are strictly prohibited.`,
        };
      }
      return { allowed: true, btcH1Rsi: btcH1Rsi !== null ? Number(btcH1Rsi.toFixed(1)) : undefined };
    } catch {
      return { allowed: true };
    }
  }

  // --- Bid/Ask Spread Guard ---
  public async checkSpreadGuard(symbol: string): Promise<{
    allowed: boolean;
    spreadPct: number;
    reason?: string;
  }> {
    try {
      const res = await proxyBinanceFetch({
        target: "spot",
        path: "/api/v3/ticker/bookTicker",
        query: `symbol=${symbol}`,
        method: "GET",
      });
      if (!res.ok) return { allowed: true, spreadPct: 0 };
      const data = await res.json();
      const bid = parseFloat(data.bidPrice);
      const ask = parseFloat(data.askPrice);
      if (bid > 0 && ask > 0) {
        const spread = ask - bid;
        const spreadPct = (spread / ask) * 100;
        if (spreadPct > 0.10) {
          return {
            allowed: false,
            spreadPct: Number(spreadPct.toFixed(3)),
            reason: `SPREAD GUARD VETO: Bid/Ask spread (${spreadPct.toFixed(3)}%) exceeds 0.10% threshold. Order blocked to prevent institutional slippage.`,
          };
        }
        return { allowed: true, spreadPct: Number(spreadPct.toFixed(3)) };
      }
    } catch {
      // fallback
    }
    return { allowed: true, spreadPct: 0 };
  }

  // --- Duplicate Protection (< 5 Minutes) ---
  public checkDuplicateProtection(symbol: string): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const fiveMinutesMs = 5 * 60 * 1000;

    const recentTrade = this.trades.find(
      (t) => t.symbol === symbol && now - t.openTime < fiveMinutesMs
    );

    if (recentTrade) {
      const remainingSec = Math.ceil((fiveMinutesMs - (now - recentTrade.openTime)) / 1000);
      return {
        allowed: false,
        reason: `DUPLICATE PROTECTION: ${symbol} was already traded within the last 5 minutes. Cooldown active for ${remainingSec}s.`,
      };
    }

    return { allowed: true };
  }

  private loadProfitVault(): number {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_VAULT);
      if (stored) return parseFloat(stored) || 0;
    } catch {
      // fallback
    }
    return 0;
  }

  public getProfitVaultTotal(): number {
    return this.profitVaultTotal;
  }

  // --- Binance API Helpers ---

  public getApiBase(marketType?: MarketType): string {
    const type = marketType ?? this.config.marketType;
    return type === "Futures" ? FUTURES_API_BASE : SPOT_API_BASE;
  }

  public async fetchAccountBalance(marketType?: MarketType): Promise<{
    usdtBalance: number;
    freeBalance: number;
    /** False when the balance could not be read from Binance. */
    ok: boolean;
    /** True when the value is the local paper-trading stub, not a real balance. */
    simulated: boolean;
    error?: string;
  }> {
    const type = marketType ?? this.config.marketType;
    if (!isLiveTradingConfigured()) {
      return { usdtBalance: 10000, freeBalance: 10000, ok: false, simulated: true };
    }

    const path = type === "Futures" ? "/fapi/v2/balance" : "/api/v3/account";

    try {
      const res = await proxyBinanceFetch({
        target: type === "Futures" ? "futures" : "spot",
        path,
        method: "GET",
        query: "",
      });
      if (!res.ok) {
        throw new Error(`Binance API error: ${res.statusText}`);
      }
      const data = await res.json();

      if (type === "Futures") {
        const usdtAsset = data.find((a: { asset: string }) => a.asset === "USDT");
        const usdtBalance = usdtAsset ? parseFloat(usdtAsset.balance) : 0;
        const freeBalance = usdtAsset ? parseFloat(usdtAsset.withdrawAvailable) : 0;
        if (!Number.isFinite(usdtBalance) || !Number.isFinite(freeBalance)) {
          return { usdtBalance: 0, freeBalance: 0, ok: false, simulated: false, error: "Malformed balance payload" };
        }
        return { usdtBalance, freeBalance, ok: true, simulated: false };
      } else {
        const balances = data.balances || [];
        const usdtAsset = balances.find((b: { asset: string }) => b.asset === "USDT");
        const freeBalance = usdtAsset ? parseFloat(usdtAsset.free) : 0;
        const lockedBalance = usdtAsset ? parseFloat(usdtAsset.locked) : 0;
        if (!Number.isFinite(freeBalance) || !Number.isFinite(lockedBalance)) {
          return { usdtBalance: 0, freeBalance: 0, ok: false, simulated: false, error: "Malformed balance payload" };
        }
        return { usdtBalance: freeBalance + lockedBalance, freeBalance, ok: true, simulated: false };
      }
    } catch (e) {
      // Never invent a $10,000 balance: a failed balance read must block sizing.
      return {
        usdtBalance: 0,
        freeBalance: 0,
        ok: false,
        simulated: false,
        error: e instanceof Error ? e.message : "Unable to read account balance",
      };
    }
  }

  /**
   * Public (unauthenticated) last-traded price. Used for the pre-execution slippage
   * check so an Auto-Pilot entry is priced against the market, not the candle close.
   */
  public async fetchLivePrice(
    symbol: string,
    marketType: MarketType = this.config.marketType
  ): Promise<number | null> {
    const base = marketType === "Futures" ? FUTURES_API_BASE : SPOT_API_BASE;
    const path = marketType === "Futures" ? "/fapi/v1/ticker/price" : "/api/v3/ticker/price";
    try {
      const res = await fetch(`${base}${path}?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) return null;
      const data = await res.json();
      const price = Number(data?.price);
      return Number.isFinite(price) && price > 0 ? price : null;
    } catch {
      return null;
    }
  }

  public async setFuturesLeverage(symbol: string, leverage: number): Promise<boolean> {
    if (this.config.marketType !== "Futures" || !isLiveTradingConfigured()) {
      return true;
    }
    const safeLev = Math.max(1, Math.min(10, leverage));

    try {
      const res = await proxyBinanceFetch({
        target: "futures",
        path: "/fapi/v1/leverage",
        method: "POST",
        body: `symbol=${symbol}&leverage=${safeLev}`,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // --- Trade Execution ---

  public async executeTrade(params: {
    symbol: string;
    entryPrice: number;
    atrValue: number;
    direction?: TradeDirection;
    marketType?: MarketType;
    accountBalance?: number;
    /** "PAPER" forces a pure local simulation. Defaults to REAL only when the
     *  server-side vault confirms live credentials are configured. */
    mode?: "REAL" | "PAPER";
    /** True when the Auto-Pilot loop is the caller (enables its cooldown gate). */
    autoPilot?: boolean;
    /** Price the signal was generated at, used for the slippage guard. */
    signalPrice?: number;
    /** Auto-Pilot uses MARKET for immediate fills; manual entries stay LIMIT. */
    orderType?: "LIMIT" | "MARKET";
  }): Promise<{ success: boolean; trade?: ManagedTrade; error?: string }> {
    const orderType: "LIMIT" | "MARKET" = params.orderType ?? "LIMIT";
    const marketType = params.marketType ?? this.config.marketType;
    const direction = params.direction ?? (marketType === "Spot" ? "LONG" : this.config.direction);

    // --- 0. Hard input validation -----------------------------------------
    if (!Number.isFinite(params.entryPrice) || params.entryPrice <= 0) {
      return { success: false, error: "Invalid entry price: a positive market price is required before execution." };
    }
    if (!Number.isFinite(params.atrValue) || params.atrValue <= 0) {
      return { success: false, error: "Invalid ATR: refusing to size a trade without volatility data." };
    }
    if (!/^[A-Z0-9]{5,20}$/.test(params.symbol)) {
      return { success: false, error: `Invalid symbol: ${params.symbol}` };
    }
    if (marketType === "Spot" && direction === "SHORT") {
      return {
        success: false,
        error: "SHORT positions are only available on Futures. Binance Spot cannot short without margin.",
      };
    }

    const liveConfigured = isLiveTradingConfigured();
    const executionMode: "REAL" | "PAPER" = params.mode === "PAPER" || !liveConfigured ? "PAPER" : "REAL";
    const useExchange = executionMode === "REAL";

    // 1. Post-Loss Cooldown Check (30 Minutes)
    const cooldown = this.getPostLossCooldown();
    if (cooldown.isActive) {
      const mins = Math.floor(cooldown.remainingSeconds / 60);
      const secs = cooldown.remainingSeconds % 60;
      const rejectMsg = `Trade rejected: Cooldown active (${mins}m ${secs}s remaining)`;
      liveWorkerLogStore.addLog(rejectMsg, "warn", { symbol: params.symbol, cooldownRemaining: cooldown.remainingSeconds });
      return {
        success: false,
        error: `POST-LOSS COOLDOWN ACTIVE: Trade blocked. ${mins}m ${secs}s remaining before new orders can be executed.`,
      };
    }

    // 1b. Auto-Pilot revenge-trading cooldown: no new entries for 30s after any close.
    if (params.autoPilot) {
      const apCooldown = this.getAutoPilotCooldown();
      if (apCooldown.isActive) {
        const msg = `Cooldown active: Preventing revenge trading. (${apCooldown.remainingSeconds}s remaining)`;
        liveWorkerLogStore.addLog(msg, "warn", { symbol: params.symbol });
        return { success: false, error: msg };
      }
    }

    // 2. Daily Drawdown Circuit Breaker Check
    const drawdown = this.getDailyDrawdown();
    if (drawdown.drawdownPct >= drawdown.maxDailyLossPercent) {
      this.pauseAutoPilot(
        `Daily max loss reached (${drawdown.drawdownPct}% >= ${drawdown.maxDailyLossPercent}%)`
      );
      // Requirement: a daily-loss breach cancels pending orders and flattens positions.
      void this.emergencyStop().catch(() => {});
      const rejectMsg = `Trade rejected: Daily drawdown breach (${drawdown.drawdownPct}% >= ${drawdown.maxDailyLossPercent}%)`;
      liveWorkerLogStore.addLog(rejectMsg, "error", { symbol: params.symbol, drawdown });
      return {
        success: false,
        error: `DAILY DRAWDOWN BREACH: Daily loss (${drawdown.drawdownPct}%) has reached or exceeded max limit of ${drawdown.maxDailyLossPercent}%. Auto-Pilot is shut down.`,
      };
    }

    // 3. Duplicate Protection (< 5 Minutes)
    const dupCheck = this.checkDuplicateProtection(params.symbol);
    if (!dupCheck.allowed) {
      const rejectMsg = `Trade rejected: Duplicate protection (${dupCheck.reason})`;
      liveWorkerLogStore.addLog(rejectMsg, "warn", { symbol: params.symbol });
      return {
        success: false,
        error: dupCheck.reason,
      };
    }

    // 4. Spread Guard Check (> 0.1% blocked)
    const spreadCheck = await this.checkSpreadGuard(params.symbol);
    if (!spreadCheck.allowed) {
      const rejectMsg = `Trade rejected: Spread guard (${spreadCheck.reason})`;
      liveWorkerLogStore.addLog(rejectMsg, "warn", { symbol: params.symbol, spreadPct: spreadCheck.spreadPct });
      return {
        success: false,
        error: spreadCheck.reason,
      };
    }

    // 5. Global Market Filter: BTC 1H dumping blocks Altcoin Longs
    const btcCheck = await this.checkBtcMarketFilter(direction, params.symbol);
    if (!btcCheck.allowed) {
      const rejectMsg = `Trade rejected: Global market filter (${btcCheck.reason})`;
      liveWorkerLogStore.addLog(rejectMsg, "warn", { symbol: params.symbol });
      return {
        success: false,
        error: btcCheck.reason,
      };
    }

    // 6. Dynamic Confluence Scaling
    const dynamicScaling = this.getRequiredConfluenceScore(params.entryPrice, params.atrValue);

    // 7. Swarm Risk Manager Veto
    const swarmResult = simulateSwarmDebate({
      symbol: params.symbol,
      price: params.entryPrice,
      atrValue: params.atrValue,
      spreadPct: spreadCheck.spreadPct,
      confluenceScore: dynamicScaling.requiredScore,
      allowAiFallback: this.config.allowAiFallback ?? true,
    });

    if (swarmResult.verdict === "NO-GO") {
      const rejectMsg = `Trade rejected: AI Swarm Risk Manager vetoed (${swarmResult.verdictReason})`;
      liveWorkerLogStore.addLog(rejectMsg, "warn", { symbol: params.symbol, reason: swarmResult.verdictReason });
      return {
        success: false,
        error: `SWARM RISK MANAGER VETO: ${swarmResult.verdictReason}`,
      };
    }

    // Subscription & Daily Limits Check (server-authoritative; consumes one unit)
    const allowance = await checkTradeExecutionAllowance({ consume: true });
    if (!allowance.allowed) {
      const rejectMsg = `Trade rejected: Daily trade allowance limit reached (${allowance.current}/${allowance.limit})`;
      liveWorkerLogStore.addLog(rejectMsg, "warn", { symbol: params.symbol, allowance });
      return {
        success: false,
        error: allowance.reason || "Daily trade allowance reached.",
      };
    }

    // Legal Disclaimer Check
    if (!this.config.disclaimerAgreed) {
      const rejectMsg = "Trade rejected: Legal Risk Disclaimer must be accepted before trading";
      liveWorkerLogStore.addLog(rejectMsg, "error", { symbol: params.symbol });
      return {
        success: false,
        error: "Legal Risk Disclaimer must be accepted before trading.",
      };
    }

    // Circuit Breaker Check
    if (this.circuitBreaker.isTripped) {
      const rejectMsg = `Trade rejected: Circuit Breaker is TRIPPED (${this.circuitBreaker.consecutiveLosses} consecutive losses)`;
      liveWorkerLogStore.addLog(rejectMsg, "error", { symbol: params.symbol });
      return {
        success: false,
        error: `Circuit Breaker is TRIPPED (${this.circuitBreaker.consecutiveLosses} consecutive losses). Auto-Pilot is disabled for capital protection.`,
      };
    }

    // Check if an active position already exists for this specific symbol in engine
    const existingPosition = this.trades.find((t) => t.symbol === params.symbol && t.status === "OPEN");
    if (existingPosition) {
      const msg = "Trade rejected: Active position exists";
      liveWorkerLogStore.addLog(msg, "warn", { symbol: params.symbol });
      console.log(msg);
      return {
        success: false,
        error: msg,
      };
    }

    // Enforce Trade Direction Mode (BOTH, LONG_ONLY, SHORT_ONLY)
    const directionMode = this.config.tradeDirectionMode || "BOTH";
    if (directionMode === "LONG_ONLY" && direction === "SHORT") {
      const rejectMsg = "Trade rejected: Auto-Pilot trade direction mode is set to LONG ONLY";
      liveWorkerLogStore.addLog(rejectMsg, "warn", { symbol: params.symbol });
      return {
        success: false,
        error: rejectMsg,
      };
    }
    if (directionMode === "SHORT_ONLY" && direction === "LONG") {
      const rejectMsg = "Trade rejected: Auto-Pilot trade direction mode is set to SHORT ONLY";
      liveWorkerLogStore.addLog(rejectMsg, "warn", { symbol: params.symbol });
      return {
        success: false,
        error: rejectMsg,
      };
    }

    // Check stuck trade timeout before evaluating capacity
    this.checkStuckTrades();

    // Max Open Trades limit (1-3)
    const openTrades = this.getOpenTrades();
    if (openTrades.length >= this.config.maxOpenTrades) {
      const rejectMsg = `Trade rejected: Max open trades reached (${openTrades.length}/${this.config.maxOpenTrades})`;
      liveWorkerLogStore.addLog(rejectMsg, "warn", { symbol: params.symbol });
      return {
        success: false,
        error: `Max open trades reached (${openTrades.length}/${this.config.maxOpenTrades}). Wait for existing positions to close.`,
      };
    }

    // ATR Stop Loss / Take Profit (computed before sizing so risk can be sized off the stop)
    const { stopLossPrice, takeProfitPrice } = calculateAtrStopLoss(
      params.entryPrice,
      params.atrValue,
      direction,
      this.config.atrMultiplier
    );

    // Balance & Sizing
    let balance: number;
    if (params.accountBalance !== undefined) {
      balance = params.accountBalance;
    } else if (useExchange) {
      const balanceResult = await this.fetchAccountBalance(marketType);
      if (!balanceResult.ok) {
        return {
          success: false,
          error: `Unable to read your Binance ${marketType} balance${balanceResult.error ? ` (${balanceResult.error})` : ""}. Trade not sent.`,
        };
      }
      balance = balanceResult.freeBalance;
    } else {
      balance = 10000; // virtual paper balance only
    }

    const leverage = marketType === "Futures" ? this.config.leverage : 1;
    const sizing = calculatePositionSize(
      this.config.riskPercent,
      balance,
      leverage,
      params.entryPrice,
      stopLossPrice
    );

    if (!Number.isFinite(sizing.quantity) || sizing.quantity <= 0) {
      return {
        success: false,
        error: "Calculated position size is 0. Check account balance, risk percentage and stop distance.",
      };
    }

    // Futures Liquidation Price & Proximity Warning
    let liquidationPrice: number | undefined;
    if (marketType === "Futures") {
      const liqInfo = calculateLiquidationPrice(params.entryPrice, leverage, direction);
      liquidationPrice = liqInfo.liquidationPrice;

      const proximity = checkLiquidationProximity(stopLossPrice, liquidationPrice, direction, params.entryPrice);
      if (proximity.isTooClose && proximity.distanceToLiqPct === 0) {
        return {
          success: false,
          error: proximity.warningMessage || "Stop Loss is past liquidation price.",
        };
      }
    }

    // --- Slippage guard: refuse to chase a price that moved after the signal ---
    if (params.signalPrice !== undefined) {
      if (!Number.isFinite(params.signalPrice) || params.signalPrice <= 0) {
        const msg = "Trade cancelled due to invalid signal price.";
        liveWorkerLogStore.addLog(msg, "error", { symbol: params.symbol });
        return { success: false, error: msg };
      }
      const slippagePct = (Math.abs(params.entryPrice - params.signalPrice) / params.signalPrice) * 100;
      if (slippagePct > MAX_SLIPPAGE_PCT) {
        const msg = `Trade cancelled due to high slippage. Price moved ${slippagePct.toFixed(3)}% (limit ${MAX_SLIPPAGE_PCT}%).`;
        liveWorkerLogStore.addLog(msg, "warn", {
          symbol: params.symbol,
          signalPrice: params.signalPrice,
          currentPrice: params.entryPrice,
          slippagePct: Number(slippagePct.toFixed(3)),
        });
        return { success: false, error: msg };
      }
    }

    // Execute on Binance only for REAL executions. PAPER trades never leave the browser.
    let orderId = "";
    let slOrderId: string | undefined;
    let tpOrderId: string | undefined;
    let slOrderError: string | undefined;
    let tpOrderError: string | undefined;

    if (useExchange) {
      if (marketType === "Futures") {
        const leverageSet = await this.setFuturesLeverage(params.symbol, leverage);
        if (!leverageSet) {
          return { success: false, error: "Binance rejected the leverage update. Trade not sent." };
        }
      }

      const clientOrderId = `ph${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      const apiResult = orderType === "MARKET"
        ? await this.placeBinanceMarketOrder({
            symbol: params.symbol,
            side: direction === "LONG" ? "BUY" : "SELL",
            quantity: sizing.quantity,
            marketType,
            clientOrderId,
          })
        : await this.placeBinanceLimitOrder({
        symbol: params.symbol,
        side: direction === "LONG" ? "BUY" : "SELL",
        quantity: sizing.quantity,
        price: params.entryPrice,
        marketType,
        clientOrderId,
      });

      if (!apiResult.orderId) {
        return {
          success: false,
          error: apiResult.error || "Binance order rejected by exchange.",
        };
      }

      // Verify the exchange response before treating the position as open.
      if (apiResult.status !== "FILLED" || !(Number(apiResult.executedQty) > 0)) {
        // The limit order is resting unfilled. Cancel it and fail closed instead of
        // recording a phantom position (SL/TP would be rejected with no position).
        await this.cancelExchangeOrder(params.symbol, String(apiResult.orderId), marketType).catch(() => {});
        return {
          success: false,
          error: `Order was accepted (status: ${apiResult.status || "UNKNOWN"}) but not filled at ${params.entryPrice}. It was cancelled — retry at the current market price.`,
        };
      }

      orderId = String(apiResult.orderId);

      // Place exchange-native Stop Loss order
      if (marketType === "Futures") {
        const slRes = await this.placeFuturesStopLossOrder({
          symbol: params.symbol,
          side: direction === "LONG" ? "SELL" : "BUY",
          stopPrice: stopLossPrice,
          quantity: sizing.quantity,
        }).catch(() => null);
        if (slRes && slRes.orderId) slOrderId = String(slRes.orderId);
        else slOrderError = slRes?.error || "Stop Loss order was not accepted by Binance";

        const tpRes = await this.placeFuturesTakeProfitOrder({
          symbol: params.symbol,
          side: direction === "LONG" ? "SELL" : "BUY",
          stopPrice: takeProfitPrice,
          quantity: sizing.quantity,
        }).catch(() => null);
        if (tpRes && tpRes.orderId) tpOrderId = String(tpRes.orderId);
        else tpOrderError = tpRes?.error || "Take Profit order was not accepted by Binance";
      }
    } else {
      // Paper / sandbox simulation — no network call to any exchange endpoint.
      orderId = `SIM-${Date.now()}`;
    }

    const trade: ManagedTrade = {
      id: orderId,
      symbol: params.symbol,
      marketType,
      direction,
      leverage,
      entryPrice: params.entryPrice,
      quantity: sizing.quantity,
      positionValue: sizing.positionValue,
      stopLossPrice,
      takeProfitPrice,
      initialStopLoss: stopLossPrice,
      trailingSlTriggered: false,
      trailingStage: "INITIAL",
      peakPrice: params.entryPrice,
      troughPrice: params.entryPrice,
      atrAtEntry: params.atrValue,
      liquidationPrice,
      openTime: Date.now(),
      status: "OPEN",
      orderId,
      slOrderId,
      tpOrderId,
      slOrderError,
      tpOrderError,
      orderType,
      executionMode,
    };

    this.trades.unshift(trade);
    this.saveTrades();

    // Persisted daily execution count (survives page refresh).
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyStats.date !== today) {
      this.dailyStats = { date: today, startingBalance: 10000, realizedPnlToday: 0, tradesOpened: 0 };
    }
    this.dailyStats.tradesOpened += 1;
    this.saveDailyStats();

    // Telegram Bot Alert & Native Push Notification
    notifyTradeOpened({
      symbol: trade.symbol,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      quantity: trade.quantity,
      leverage: trade.leverage,
      marketType: trade.marketType,
      stopLossPrice: trade.stopLossPrice,
      takeProfitPrice: trade.takeProfitPrice,
    }).catch(() => {});

    pushNotificationService.notifyTradeExecution({
      symbol: trade.symbol,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      source: "Auto-Trade Engine",
      mode: executionMode,
    }).catch(() => {});

    return {
      success: true,
      trade,
    };
  }

  private async placeBinanceLimitOrder(params: {
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    price: number;
    marketType: MarketType;
    clientOrderId?: string;
  }): Promise<{
    orderId?: string | number;
    status?: string;
    executedQty?: number;
    error?: string;
  }> {
    const path = params.marketType === "Futures" ? "/fapi/v1/order" : "/api/v3/order";

    if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
      return { error: "Invalid order quantity" };
    }
    if (!Number.isFinite(params.price) || params.price <= 0) {
      return { error: "Invalid order price" };
    }

    const bodyParts = [
      `symbol=${params.symbol}`,
      `side=${params.side}`,
      `type=LIMIT`,
      `timeInForce=GTC`,
      `quantity=${params.quantity}`,
      `price=${params.price}`,
      // ACK|RESULT: return the fill state so we can verify execution instead of
      // assuming a resting order was filled.
      `newOrderRespType=RESULT`,
    ];
    if (params.clientOrderId) {
      // Idempotency key: Binance rejects a duplicate clientOrderId for ~24h, which
      // prevents double submission of the same logical order.
      bodyParts.push(`newClientOrderId=${params.clientOrderId}`);
    }
    const body = bodyParts.join("&");

    try {
      const res = await proxyBinanceFetch({
        target: params.marketType === "Futures" ? "futures" : "spot",
        path,
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { error: data?.msg || `Order placement failed (HTTP ${res.status})` };
      }
      if (!data?.orderId) {
        return { error: "Binance response contained no orderId" };
      }
      return {
        orderId: data.orderId,
        status: typeof data.status === "string" ? data.status : undefined,
        executedQty: Number(data.executedQty ?? 0),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Network error" };
    }
  }

  /**
   * Market order used by Auto-Pilot: guarantees an immediate fill so the recorded
   * entry price matches the exchange, then SL/TP can be attached to a real position.
   */
  private async placeBinanceMarketOrder(params: {
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    marketType: MarketType;
    clientOrderId?: string;
  }): Promise<{
    orderId?: string | number;
    status?: string;
    executedQty?: number;
    error?: string;
  }> {
    if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
      return { error: "Invalid order quantity" };
    }

    const bodyParts = [
      `symbol=${params.symbol}`,
      `side=${params.side}`,
      "type=MARKET",
      `quantity=${params.quantity}`,
      "newOrderRespType=RESULT",
    ];
    if (params.clientOrderId) bodyParts.push(`newClientOrderId=${params.clientOrderId}`);

    try {
      const res = await proxyBinanceFetch({
        target: params.marketType === "Futures" ? "futures" : "spot",
        path: params.marketType === "Futures" ? "/fapi/v1/order" : "/api/v3/order",
        method: "POST",
        body: bodyParts.join("&"),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { error: data?.msg || `Market order failed (HTTP ${res.status})` };
      }
      if (!data?.orderId) return { error: "Binance response contained no orderId" };
      return {
        orderId: data.orderId,
        status: typeof data.status === "string" ? data.status : undefined,
        executedQty: Number(data.executedQty ?? 0),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Network error" };
    }
  }

  private async placeFuturesStopLossOrder(params: {
    symbol: string;
    side: "BUY" | "SELL";
    stopPrice: number;
    quantity: number;
  }): Promise<{ orderId?: string | number; error?: string }> {
    const body = [
      `symbol=${params.symbol}`,
      `side=${params.side}`,
      `type=STOP_MARKET`,
      `stopPrice=${params.stopPrice}`,
      `closePosition=true`,
    ].join("&");

    try {
      const res = await proxyBinanceFetch({
        target: "futures",
        path: "/fapi/v1/order",
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        return { error: data.msg || "Stop Loss order placement failed" };
      }
      return { orderId: data.orderId };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Network error" };
    }
  }

  private async placeFuturesTakeProfitOrder(params: {
    symbol: string;
    side: "BUY" | "SELL";
    stopPrice: number;
    quantity: number;
  }): Promise<{ orderId?: string | number; error?: string }> {
    const body = [
      `symbol=${params.symbol}`,
      `side=${params.side}`,
      `type=TAKE_PROFIT_MARKET`,
      `stopPrice=${params.stopPrice}`,
      `closePosition=true`,
    ].join("&");

    try {
      const res = await proxyBinanceFetch({
        target: "futures",
        path: "/fapi/v1/order",
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        return { error: data.msg || "Take Profit order placement failed" };
      }
      return { orderId: data.orderId };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Network error" };
    }
  }

  /**
   * OCO Cancel Helper: Cancels a specific order on Binance Futures or Spot
   */
  public async cancelExchangeOrder(symbol: string, orderId: string, marketType: MarketType = "Futures"): Promise<boolean> {
    if (!isLiveTradingConfigured() || !orderId) return true;
    try {
      const path = marketType === "Futures" ? "/fapi/v1/order" : "/api/v3/order";
      const query = `symbol=${symbol}&orderId=${orderId}`;

      const res = await proxyBinanceFetch({
        target: marketType === "Futures" ? "futures" : "spot",
        path,
        method: "DELETE",
        query,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Replaces the resting exchange Stop Loss with a new stop price (trailing SL).
   * Only ever called for REAL futures positions.
   */
  public async replaceExchangeStopLoss(trade: ManagedTrade, newStopPrice: number): Promise<boolean> {
    if (trade.executionMode !== "REAL" || !isLiveTradingConfigured() || trade.marketType !== "Futures") {
      return true;
    }

    if (trade.slOrderId) {
      const cancelled = await this.cancelExchangeOrder(trade.symbol, trade.slOrderId, "Futures").catch(() => false);
      if (!cancelled) {
        console.warn(`[Trailing SL] Could not cancel previous SL order ${trade.slOrderId} for ${trade.symbol}; keeping local stop only.`);
        return false;
      }
    }

    const res = await this.placeFuturesStopLossOrder({
      symbol: trade.symbol,
      side: trade.direction === "LONG" ? "SELL" : "BUY",
      stopPrice: newStopPrice,
      quantity: trade.quantity,
    }).catch(() => null);

    if (res && res.orderId) {
      trade.slOrderId = String(res.orderId);
      return true;
    }

    trade.slOrderError = res?.error || "Failed to move exchange Stop Loss";
    console.warn(`[Trailing SL] ${trade.slOrderError} (${trade.symbol})`);
    return false;
  }

  public async closeExchangePosition(trade: ManagedTrade): Promise<boolean> {
    if (trade.executionMode !== "REAL" || !isLiveTradingConfigured()) return true;

    try {
      const body =
        trade.marketType === "Futures"
          ? [
              `symbol=${trade.symbol}`,
              `side=${trade.direction === "LONG" ? "SELL" : "BUY"}`,
              `type=MARKET`,
              `quantity=${trade.quantity}`,
              `reduceOnly=true`,
            ].join("&")
          : [
              `symbol=${trade.symbol}`,
              `side=SELL`,
              `type=MARKET`,
              `quantity=${trade.quantity}`,
            ].join("&");

      const res = await proxyBinanceFetch({
        target: trade.marketType === "Futures" ? "futures" : "spot",
        path: trade.marketType === "Futures" ? "/fapi/v1/order" : "/api/v3/order",
        method: "POST",
        body,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.warn(`[Close Position] Binance rejected ${trade.symbol}: ${data?.msg || res.statusText}`);
        return false;
      }
      return true;
    } catch (e) {
      console.warn(`[Close Position] ${e instanceof Error ? e.message : "network error"}`);
      return false;
    }
  }

  public evaluateOpenTrades(currentPrice: number, symbol: string): ManagedTrade[] {
    const updatedTrades: ManagedTrade[] = [];

    for (const trade of this.trades) {
      if (trade.status !== "OPEN" || trade.symbol !== symbol) continue;

      // Update peak / trough
      if (trade.direction === "LONG") {
        trade.peakPrice = Math.max(trade.peakPrice ?? trade.entryPrice, currentPrice);
      } else {
        trade.troughPrice = Math.min(trade.troughPrice ?? trade.entryPrice, currentPrice);
      }

      if (this.config.trailingSlEnabled) {
        const trailingEval = evaluateTrailingStopLoss(currentPrice, trade);
        if (trailingEval.shouldUpdateSl) {
          trade.stopLossPrice = trailingEval.newStopLoss;
          trade.trailingSlTriggered = true;
          if (trailingEval.newTrailingStage) trade.trailingStage = trailingEval.newTrailingStage;
          if (trailingEval.newPeak) trade.peakPrice = trailingEval.newPeak;
          if (trailingEval.newTrough) trade.troughPrice = trailingEval.newTrough;

          // Keep the exchange-side stop in sync, otherwise a live position would
          // still be protected only by the original (wider) stop.
          if (trade.executionMode === "REAL" && trade.marketType === "Futures") {
            this.replaceExchangeStopLoss(trade, trailingEval.newStopLoss).catch(() => {});
          }

          updatedTrades.push({ ...trade });

          pushNotificationService.notifyTrailingStopMoved({
            symbol: trade.symbol,
            newStopLoss: trailingEval.newStopLoss,
            stage: trailingEval.newTrailingStage || "BREAK_EVEN",
          }).catch(() => {});
        }
      }

      let exitTriggered = false;
      let exitType: "TP" | "SL" | null = null;

      if (trade.direction === "LONG") {
        if (currentPrice <= trade.stopLossPrice) {
          exitTriggered = true;
          exitType = "SL";
        } else if (currentPrice >= trade.takeProfitPrice) {
          exitTriggered = true;
          exitType = "TP";
        }
      } else {
        if (currentPrice >= trade.stopLossPrice) {
          exitTriggered = true;
          exitType = "SL";
        } else if (currentPrice <= trade.takeProfitPrice) {
          exitTriggered = true;
          exitType = "TP";
        }
      }

      if (exitTriggered && exitType) {
        this.closeTrade(trade.id, currentPrice, exitType);
        updatedTrades.push({ ...trade });
      }
    }

    if (updatedTrades.length > 0) {
      this.saveTrades();
    }

    return updatedTrades;
  }

  public closeTrade(tradeId: string, exitPrice: number, exitReason: "TP" | "SL" | "MANUAL"): ManagedTrade | null {
    const trade = this.trades.find((t) => t.id === tradeId);
    if (!trade || trade.status !== "OPEN") return null;

    trade.status = "CLOSED";
    trade.closePrice = exitPrice;

    const priceDiff = trade.direction === "LONG"
      ? exitPrice - trade.entryPrice
      : trade.entryPrice - exitPrice;

    // NOTE: `quantity` is already the full levered position size (margin * leverage /
    // entry), so multiplying by leverage again would overstate P/L by the leverage factor.
    const realizedPnl = priceDiff * trade.quantity;
    trade.realizedPnl = Number(realizedPnl.toFixed(2));

    // A mandatory pause after ANY close (TP/SL/manual) blocks revenge re-entry.
    this.startAutoPilotCooldown(AUTOPILOT_COOLDOWN_SECONDS);

    // OCO Logic: When TP is hit, automatically cancel associated SL order; if SL is hit, cancel TP order
    if (exitReason === "TP") {
      if (trade.slOrderId) {
        this.cancelExchangeOrder(trade.symbol, trade.slOrderId, trade.marketType).catch(() => {});
      }
    } else if (exitReason === "SL") {
      if (trade.tpOrderId) {
        this.cancelExchangeOrder(trade.symbol, trade.tpOrderId, trade.marketType).catch(() => {});
      }
    }

    // Execute exchange-level close only for positions that were really opened.
    if (trade.executionMode === "REAL") {
      this.closeExchangePosition(trade).catch(() => {});
    }

    if (trade.executionMode === "REAL" && this.config.profitVaultEnabled && realizedPnl > 0) {
      const vaultCut = Number((realizedPnl * 0.5).toFixed(2));
      trade.profitVaultAmount = vaultCut;
      this.profitVaultTotal += vaultCut;
      localStorage.setItem(STORAGE_KEY_VAULT, String(this.profitVaultTotal.toFixed(2)));

      if (trade.marketType === "Futures" && trade.executionMode === "REAL" && isLiveTradingConfigured()) {
        this.transferProfitToSpotWallet(vaultCut).catch(() => {});
      }
    }

    // Update daily PnL stats
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyStats.date !== today) {
      this.dailyStats = {
        date: today,
        startingBalance: 10000,
        realizedPnlToday: 0,
        tradesOpened: 0,
      };
    }
    this.dailyStats.realizedPnlToday = Number((this.dailyStats.realizedPnlToday + realizedPnl).toFixed(2));
    this.saveDailyStats();

    // Check Daily Drawdown Circuit Breaker
    const drawdown = this.getDailyDrawdown();
    if (drawdown.drawdownPct >= drawdown.maxDailyLossPercent) {
      this.pauseAutoPilot(
        `Daily max loss reached (${drawdown.drawdownPct}% >= ${drawdown.maxDailyLossPercent}%)`
      );
      this.circuitBreaker.isTripped = true;
      this.circuitBreaker.trippedAt = Date.now();
      this.circuitBreaker.reason = `Max Daily Loss % reached (${drawdown.drawdownPct}% >= ${drawdown.maxDailyLossPercent}%). Auto-Pilot disabled.`;
      this.saveCircuitBreaker();

      // Close all remaining positions
      this.emergencyStop().catch(() => {});

      // Urgent Telegram Alert
      sendTelegramAlert(
        `🚨 <b>[CIRCUIT BREAKER ENGAGED]</b>\n` +
        `Max Daily Loss reached: <b>-${drawdown.drawdownPct.toFixed(2)}%</b> (Limit: ${drawdown.maxDailyLossPercent}%).\n` +
        `Auto-Pilot has been immediately shut OFF, and all active positions have been liquidated.`
      ).catch(() => {});
    }

    if (realizedPnl < 0) {
      this.circuitBreaker.consecutiveLosses += 1;

      // 1. Post-Loss Cooldown: If a trade hits Stop Loss, enter 30-minute cooldown
      if (exitReason === "SL" || realizedPnl < 0) {
        const cooldownUntil = Date.now() + 30 * 60 * 1000;
        this.savePostLossCooldown(cooldownUntil);
      }

      if (this.circuitBreaker.consecutiveLosses >= 2) {
        this.circuitBreaker.isTripped = true;
        this.circuitBreaker.trippedAt = Date.now();
        this.circuitBreaker.reason = "2 consecutive losses detected. Fortress Circuit Breaker tripped: Auto-Pilot disabled.";
        this.config.autoPilotEnabled = false;
        this.saveConfig({ autoPilotEnabled: false });
      }
      this.saveCircuitBreaker();
    } else if (realizedPnl > 0) {
      this.circuitBreaker.consecutiveLosses = 0;
      this.saveCircuitBreaker();
    }

    this.saveTrades();

    // Telegram Bot Alert & Native Push on Trade Closed / OCO
    notifyTradeClosed({
      symbol: trade.symbol,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      closePrice: trade.closePrice,
      realizedPnl: trade.realizedPnl,
      profitVaultAmount: trade.profitVaultAmount,
      exitReason,
    }).catch(() => {});

    if (exitReason === "TP" || exitReason === "SL") {
      pushNotificationService.notifyOcoTriggered({
        symbol: trade.symbol,
        exitReason,
        exitPrice: trade.closePrice,
        pnl: trade.realizedPnl ?? 0,
      }).catch(() => {});
    }

    return trade;
  }

  public async transferProfitToSpotWallet(amount: number): Promise<boolean> {
    if (!isLiveTradingConfigured() || amount <= 0) return false;

    try {
      const res = await proxyBinanceFetch({
        target: "spot",
        path: "/sapi/v1/futures/transfer",
        method: "POST",
        body: `asset=USDT&amount=${amount}&type=2`,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async emergencyStop(): Promise<{
    cancelledOrdersCount: number;
    closedPositionsCount: number;
    spotSuccess: boolean;
    futuresSuccess: boolean;
  }> {
    let spotSuccess = true;
    let futuresSuccess = true;
    let cancelledOrdersCount = 0;
    let closedPositionsCount = 0;

    this.config.autoPilotEnabled = false;
    this.saveConfig({ autoPilotEnabled: false });
    // Preserve a PAUSED state (e.g. daily-loss halt) so the UI keeps showing why.
    this.autoPilotState = this.autoPilotPauseReason ? "PAUSED" : "IDLE";
    liveWorkerLogStore.addLog(
      "KILL SWITCH ENGAGED: Auto-Pilot halted, cancelling open orders and closing positions.",
      "error"
    );

    if (isLiveTradingConfigured()) {
      // Spot: cancel every open order across all symbols in one call.
      try {
        const spotCancelAll = await proxyBinanceFetch({
          target: "spot",
          path: "/api/v3/openOrders",
          method: "DELETE",
          query: "",
        });
        if (spotCancelAll.ok) cancelledOrdersCount++;
        else spotSuccess = false;
      } catch {
        spotSuccess = false;
      }
      try {
        const openFuturesTrades = this.trades.filter(
          (t) => t.status === "OPEN" && t.marketType === "Futures" && t.executionMode === "REAL"
        );
        const symbols = Array.from(new Set(openFuturesTrades.map((t) => t.symbol)));

        for (const sym of symbols) {
          await proxyBinanceFetch({
            target: "futures",
            path: "/fapi/v1/allOpenOrders",
            method: "DELETE",
            query: `symbol=${sym}`,
          });
          cancelledOrdersCount++;
        }
      } catch {
        futuresSuccess = false;
      }

      try {
        // Cancel any residual spot orders per tracked symbol as well (belt and braces).
        const openSpotTrades = this.trades.filter(
          (t) => t.status === "OPEN" && t.marketType === "Spot" && t.executionMode === "REAL"
        );
        const symbols = Array.from(new Set(openSpotTrades.map((t) => t.symbol)));

        for (const sym of symbols) {
          const res = await proxyBinanceFetch({
            target: "spot",
            path: "/api/v3/openOrders",
            method: "DELETE",
            query: `symbol=${sym}`,
          });
          if (res.ok) cancelledOrdersCount++;
        }
      } catch {
        spotSuccess = false;
      }
    }

    for (const trade of this.trades) {
      if (trade.status === "OPEN") {
        if (trade.executionMode === "REAL") {
          // Close the real exchange position before marking the record closed.
          await this.closeExchangePosition(trade).catch(() => false);
        }
        trade.status = "CLOSED";
        trade.closePrice = trade.entryPrice;
        trade.realizedPnl = 0;
        closedPositionsCount++;
      }
    }

    this.saveTrades();

    return {
      cancelledOrdersCount,
      closedPositionsCount,
      spotSuccess,
      futuresSuccess,
    };
  }
}

export const autoTradeEngine = new BinanceAutoTradeEngine();
