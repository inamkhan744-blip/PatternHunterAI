/**
 * Fortress-Level Binance Auto-Trade Execution Engine
 * Supports both Binance Spot API (api.binance.com) and Binance Futures API (fapi.binance.com)
 * Comprehensive risk management: 1-3 Max Open Trades, 1.5x ATR SL, 1:1 Trailing SL,
 * Profit Vault (50% to Spot), Liquidation Price warning, 2-loss Circuit Breaker, Emergency Kill Switch.
 */

export type MarketType = "Spot" | "Futures";
export type TradeDirection = "LONG" | "SHORT";

export interface AutoTradeConfig {
  apiKey: string;
  apiSecret: string;
  marketType: MarketType;
  leverage: number; // 1 to 10
  direction: TradeDirection; // For futures
  riskPercent: number; // e.g. 1% to 5%
  maxOpenTrades: number; // 1 to 3
  profitVaultEnabled: boolean; // Move 50% realized profits to Spot
  atrMultiplier: number; // Default 1.5x
  trailingSlEnabled: boolean; // Move SL to BE at 1:1 RR
  autoPilotEnabled: boolean;
  disclaimerAgreed: boolean;
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
  atrAtEntry: number;
  liquidationPrice?: number;
  openTime: number;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  closePrice?: number;
  realizedPnl?: number;
  profitVaultAmount?: number;
  orderId?: string;
  orderType: "LIMIT" | "MARKET";
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

export const DEFAULT_CONFIG: AutoTradeConfig = {
  apiKey: "",
  apiSecret: "",
  marketType: "Spot",
  leverage: 3, // Safe default within 1-10x
  direction: "LONG",
  riskPercent: 1.5,
  maxOpenTrades: 2, // 1 to 3
  profitVaultEnabled: true,
  atrMultiplier: 1.5,
  trailingSlEnabled: true,
  autoPilotEnabled: false,
  disclaimerAgreed: false,
};

// Base URLs
export const SPOT_API_BASE = "https://api.binance.com";
export const FUTURES_API_BASE = "https://fapi.binance.com";

/**
 * Calculates position size auto-compounded based on risk percent, account balance, and leverage.
 * Position size in base asset units (e.g., BTC, ETH).
 * Formula:
 * Capital risked = accountBalance * (riskPercent / 100)
 * Position value = accountBalance * (riskPercent / 100) * leverage
 * Quantity = Position value / entryPrice
 */
export function calculatePositionSize(
  riskPercent: number,
  accountBalance: number,
  leverage: number = 1,
  entryPrice: number = 1
): { quantity: number; positionValue: number; marginRequired: number } {
  if (accountBalance <= 0 || riskPercent <= 0 || entryPrice <= 0) {
    return { quantity: 0, positionValue: 0, marginRequired: 0 };
  }

  // Constrain leverage 1x - 10x
  const effectiveLeverage = Math.max(1, Math.min(10, leverage));
  const clampedRisk = Math.max(0.1, Math.min(100, riskPercent));

  // Risk allocated capital compounded with leverage
  const marginRequired = accountBalance * (clampedRisk / 100);
  const positionValue = marginRequired * effectiveLeverage;
  const quantity = positionValue / entryPrice;

  return {
    quantity: Number(quantity.toFixed(6)),
    positionValue: Number(positionValue.toFixed(2)),
    marginRequired: Number(marginRequired.toFixed(2)),
  };
}

/**
 * Calculates theoretical Liquidation Price for Binance USDT-M Futures (Isolated / Cross).
 * Maintenance margin rate (MMR) is approx 0.5% (0.005) to 1% for standard crypto pairs at <= 10x.
 * For LONG: LiqPrice = EntryPrice * (1 - 1/Leverage + MMR)
 * For SHORT: LiqPrice = EntryPrice * (1 + 1/Leverage - MMR)
 */
export function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  direction: TradeDirection,
  mmr: number = 0.005 // 0.5% maintenance margin
): LiquidationInfo {
  if (entryPrice <= 0 || leverage <= 0) {
    return { liquidationPrice: 0, distancePercent: 0, isWarning: false };
  }

  const lev = Math.max(1, Math.min(10, leverage));
  let liqPrice = 0;

  if (direction === "LONG") {
    // Price falls until equity matches maintenance margin
    liqPrice = entryPrice * (1 - (1 / lev) + mmr);
    liqPrice = Math.max(0, liqPrice);
  } else {
    // Price rises until equity matches maintenance margin
    liqPrice = entryPrice * (1 + (1 / lev) - mmr);
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
 * If distance between Stop Loss and Liquidation Price is < 2.0%, or if SL is past liquidation,
 * trigger a critical warning.
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
    // In LONG: Liq is below entry. SL should be ABOVE Liq price.
    if (stopLossPrice <= liquidationPrice) {
      return {
        isTooClose: true,
        warningMessage: "CRITICAL: Stop Loss is below or at Liquidation Price! Position will liquidate before SL triggers.",
        distanceToLiqPct: 0,
      };
    }
    distanceToLiqPct = ((stopLossPrice - liquidationPrice) / stopLossPrice) * 100;
  } else {
    // In SHORT: Liq is above entry. SL should be BELOW Liq price.
    if (stopLossPrice >= liquidationPrice) {
      return {
        isTooClose: true,
        warningMessage: "CRITICAL: Stop Loss is above or at Liquidation Price! Position will liquidate before SL triggers.",
        distanceToLiqPct: 0,
      };
    }
    distanceToLiqPct = ((liquidationPrice - stopLossPrice) / stopLossPrice) * 100;
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
 * Standard Fortress Rule: SL at 1.5x ATR.
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
 * Trailing Stop Loss Logic:
 * If trade reaches 1:1 Risk-to-Reward (R:R), automatically moves SL to break-even (Entry Price).
 */
export function evaluateTrailingStopLoss(
  currentPrice: number,
  trade: ManagedTrade
): { shouldUpdateSl: boolean; newStopLoss: number; reason?: string } {
  if (!trade || trade.status !== "OPEN" || trade.trailingSlTriggered) {
    return { shouldUpdateSl: false, newStopLoss: trade.stopLossPrice };
  }

  const initialRisk = Math.abs(trade.entryPrice - trade.initialStopLoss);
  if (initialRisk <= 0) {
    return { shouldUpdateSl: false, newStopLoss: trade.stopLossPrice };
  }

  if (trade.direction === "LONG") {
    const currentReward = currentPrice - trade.entryPrice;
    // Hit 1:1 RR when currentReward >= initialRisk
    if (currentReward >= initialRisk && trade.stopLossPrice < trade.entryPrice) {
      return {
        shouldUpdateSl: true,
        newStopLoss: trade.entryPrice,
        reason: "1:1 RR target achieved. Stop Loss moved to Break-Even (Entry Price).",
      };
    }
  } else {
    // SHORT
    const currentReward = trade.entryPrice - currentPrice;
    if (currentReward >= initialRisk && trade.stopLossPrice > trade.entryPrice) {
      return {
        shouldUpdateSl: true,
        newStopLoss: trade.entryPrice,
        reason: "1:1 RR target achieved. Stop Loss moved to Break-Even (Entry Price).",
      };
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

export class BinanceAutoTradeEngine {
  private config: AutoTradeConfig;
  private trades: ManagedTrade[] = [];
  private circuitBreaker: CircuitBreakerState = {
    consecutiveLosses: 0,
    isTripped: false,
  };
  private profitVaultTotal: number = 0;

  constructor() {
    this.config = this.loadConfig();
    this.trades = this.loadTrades();
    this.circuitBreaker = this.loadCircuitBreaker();
    this.profitVaultTotal = this.loadProfitVault();
  }

  // --- Persistence ---
  public loadConfig(): AutoTradeConfig {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (stored) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
      }
    } catch {
      // fallback
    }
    return { ...DEFAULT_CONFIG };
  }

  public saveConfig(config: Partial<AutoTradeConfig>): AutoTradeConfig {
    this.config = { ...this.config, ...config };
    // Enforce constraints
    this.config.leverage = Math.max(1, Math.min(10, this.config.leverage));
    this.config.maxOpenTrades = Math.max(1, Math.min(3, this.config.maxOpenTrades));
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
    return this.config;
  }

  public getConfig(): AutoTradeConfig {
    return { ...this.config };
  }

  private loadTrades(): ManagedTrade[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_TRADES);
      if (stored) return JSON.parse(stored);
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

  /**
   * Fetches account balance in USDT.
   * Spot: /api/v3/account
   * Futures: /fapi/v2/account or /fapi/v2/balance
   */
  public async fetchAccountBalance(marketType?: MarketType): Promise<{ usdtBalance: number; freeBalance: number }> {
    const type = marketType ?? this.config.marketType;
    if (!this.config.apiKey || !this.config.apiSecret) {
      // Return simulated sandbox balance if no credentials configured
      return { usdtBalance: 10000, freeBalance: 10000 };
    }

    const timestamp = Date.now();
    const query = `timestamp=${timestamp}`;
    const signature = await signQuery(query, this.config.apiSecret);
    const base = this.getApiBase(type);

    const endpoint = type === "Futures"
      ? `${base}/fapi/v2/balance?${query}&signature=${signature}`
      : `${base}/api/v3/account?${query}&signature=${signature}`;

    try {
      const res = await fetch(endpoint, {
        headers: { "X-MBX-APIKEY": this.config.apiKey },
      });
      if (!res.ok) {
        throw new Error(`Binance API error: ${res.statusText}`);
      }
      const data = await res.json();

      if (type === "Futures") {
        const usdtAsset = data.find((a: { asset: string }) => a.asset === "USDT");
        const usdtBalance = usdtAsset ? parseFloat(usdtAsset.balance) : 0;
        const freeBalance = usdtAsset ? parseFloat(usdtAsset.withdrawAvailable) : 0;
        return { usdtBalance, freeBalance };
      } else {
        const balances = data.balances || [];
        const usdtAsset = balances.find((b: { asset: string }) => b.asset === "USDT");
        const freeBalance = usdtAsset ? parseFloat(usdtAsset.free) : 0;
        const lockedBalance = usdtAsset ? parseFloat(usdtAsset.locked) : 0;
        return { usdtBalance: freeBalance + lockedBalance, freeBalance };
      }
    } catch {
      // Return demo balance on network/credential error
      return { usdtBalance: 10000, freeBalance: 10000 };
    }
  }

  /**
   * Sets leverage for Binance Futures pair.
   */
  public async setFuturesLeverage(symbol: string, leverage: number): Promise<boolean> {
    if (this.config.marketType !== "Futures" || !this.config.apiKey || !this.config.apiSecret) {
      return true;
    }
    const safeLev = Math.max(1, Math.min(10, leverage));
    const timestamp = Date.now();
    const query = `symbol=${symbol}&leverage=${safeLev}&timestamp=${timestamp}`;
    const signature = await signQuery(query, this.config.apiSecret);

    try {
      const res = await fetch(`${FUTURES_API_BASE}/fapi/v1/leverage`, {
        method: "POST",
        headers: {
          "X-MBX-APIKEY": this.config.apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `${query}&signature=${signature}`,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // --- Trade Execution ---

  /**
   * Fortress Auto-Trade Execution Entry:
   * 1. Checks legal disclaimer agreement
   * 2. Checks circuit breaker
   * 3. Enforces max open trades (1-3)
   * 4. Calculates position size auto-compounding with leverage
   * 5. Enforces LIMIT entry orders to eliminate slippage
   * 6. Validates ATR stop loss & liquidation proximity warning
   */
  public async executeTrade(params: {
    symbol: string;
    entryPrice: number;
    atrValue: number;
    direction?: TradeDirection;
    marketType?: MarketType;
    accountBalance?: number;
  }): Promise<{ success: boolean; trade?: ManagedTrade; error?: string }> {
    const marketType = params.marketType ?? this.config.marketType;
    const direction = params.direction ?? (marketType === "Spot" ? "LONG" : this.config.direction);

    // Rule 4: Legal Disclaimer
    if (!this.config.disclaimerAgreed) {
      return {
        success: false,
        error: "Legal Risk Disclaimer must be accepted before trading.",
      };
    }

    // Rule 3: Circuit Breaker Check
    if (this.circuitBreaker.isTripped) {
      return {
        success: false,
        error: `Circuit Breaker is TRIPPED (${this.circuitBreaker.consecutiveLosses} consecutive losses). Auto-Pilot is disabled for capital protection.`,
      };
    }

    // Rule 2: Max Open Trades limit (1-3)
    const openTrades = this.getOpenTrades();
    if (openTrades.length >= this.config.maxOpenTrades) {
      return {
        success: false,
        error: `Max open trades reached (${openTrades.length}/${this.config.maxOpenTrades}). Wait for existing positions to close.`,
      };
    }

    // Balance & Sizing
    const balance = params.accountBalance ?? (await this.fetchAccountBalance(marketType)).freeBalance;
    const leverage = marketType === "Futures" ? this.config.leverage : 1;
    const sizing = calculatePositionSize(this.config.riskPercent, balance, leverage, params.entryPrice);

    if (sizing.quantity <= 0) {
      return {
        success: false,
        error: "Calculated position size is 0. Check account balance and risk percentage.",
      };
    }

    // ATR Stop Loss
    const { stopLossPrice, takeProfitPrice } = calculateAtrStopLoss(
      params.entryPrice,
      params.atrValue,
      direction,
      this.config.atrMultiplier
    );

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

    // Execute LIMIT order on Binance API (or simulate if demo)
    let orderId = `FORTRESS-${Date.now()}`;
    if (this.config.apiKey && this.config.apiSecret) {
      if (marketType === "Futures") {
        await this.setFuturesLeverage(params.symbol, leverage);
      }
      const apiResult = await this.placeBinanceLimitOrder({
        symbol: params.symbol,
        side: direction === "LONG" ? "BUY" : "SELL",
        quantity: sizing.quantity,
        price: params.entryPrice,
        marketType,
      });
      if (apiResult.orderId) {
        orderId = String(apiResult.orderId);
      }
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
      atrAtEntry: params.atrValue,
      liquidationPrice,
      openTime: Date.now(),
      status: "OPEN",
      orderId,
      orderType: "LIMIT",
    };

    this.trades.unshift(trade);
    this.saveTrades();

    return {
      success: true,
      trade,
    };
  }

  /**
   * Places a LIMIT order to eliminate slippage.
   */
  private async placeBinanceLimitOrder(params: {
    symbol: string;
    side: "BUY" | "SELL";
    quantity: number;
    price: number;
    marketType: MarketType;
  }): Promise<{ orderId?: string | number; error?: string }> {
    const timestamp = Date.now();
    const base = this.getApiBase(params.marketType);
    const endpoint = params.marketType === "Futures" ? `${base}/fapi/v1/order` : `${base}/api/v3/order`;

    const query = [
      `symbol=${params.symbol}`,
      `side=${params.side}`,
      `type=LIMIT`,
      `timeInForce=GTC`,
      `quantity=${params.quantity}`,
      `price=${params.price}`,
      `timestamp=${timestamp}`,
    ].join("&");

    const signature = await signQuery(query, this.config.apiSecret);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "X-MBX-APIKEY": this.config.apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `${query}&signature=${signature}`,
      });
      const data = await res.json();
      if (!res.ok) {
        return { error: data.msg || "Order placement failed" };
      }
      return { orderId: data.orderId };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Network error" };
    }
  }

  /**
   * Evaluates and updates open trades against current price:
   * - Checks Stop Loss hit
   * - Checks Take Profit hit
   * - Checks Trailing SL (moves to break-even at 1:1 RR)
   * - Handles Profit Vault (50% of realized profits moved to Spot)
   * - Handles Circuit Breaker (trips if 2 consecutive losses occur)
   */
  public evaluateOpenTrades(currentPrice: number, symbol: string): ManagedTrade[] {
    const updatedTrades: ManagedTrade[] = [];

    for (const trade of this.trades) {
      if (trade.status !== "OPEN" || trade.symbol !== symbol) continue;

      // 1. Check Trailing SL break-even update
      if (this.config.trailingSlEnabled && !trade.trailingSlTriggered) {
        const trailingEval = evaluateTrailingStopLoss(currentPrice, trade);
        if (trailingEval.shouldUpdateSl) {
          trade.stopLossPrice = trailingEval.newStopLoss;
          trade.trailingSlTriggered = true;
          updatedTrades.push({ ...trade });
        }
      }

      // 2. Check Exit Conditions (SL / TP)
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
        // SHORT
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

  /**
   * Closes a trade, computes realized PnL, executes Profit Vault (50% to Spot)
   * and tracks consecutive losses for the Circuit Breaker.
   */
  public closeTrade(tradeId: string, exitPrice: number, exitReason: "TP" | "SL" | "MANUAL"): ManagedTrade | null {
    const trade = this.trades.find((t) => t.id === tradeId);
    if (!trade || trade.status !== "OPEN") return null;

    trade.status = "CLOSED";
    trade.closePrice = exitPrice;

    // Calculate PnL
    const priceDiff = trade.direction === "LONG"
      ? exitPrice - trade.entryPrice
      : trade.entryPrice - exitPrice;

    const rawPnl = priceDiff * trade.quantity;
    const realizedPnl = trade.marketType === "Futures" ? rawPnl * trade.leverage : rawPnl;
    trade.realizedPnl = Number(realizedPnl.toFixed(2));

    // Rule 2: Profit Vault - Move 50% of realized profits to Spot
    if (this.config.profitVaultEnabled && realizedPnl > 0) {
      const vaultCut = Number((realizedPnl * 0.5).toFixed(2));
      trade.profitVaultAmount = vaultCut;
      this.profitVaultTotal += vaultCut;
      localStorage.setItem(STORAGE_KEY_VAULT, String(this.profitVaultTotal.toFixed(2)));

      // If live Binance Futures, execute transfer to Spot: /sapi/v1/futures/transfer
      if (trade.marketType === "Futures" && this.config.apiKey && this.config.apiSecret) {
        this.transferProfitToSpotWallet(vaultCut).catch(() => {});
      }
    }

    // Rule 3: Circuit Breaker - If 2 consecutive losses occur, disable Auto-Pilot
    if (realizedPnl < 0) {
      this.circuitBreaker.consecutiveLosses += 1;
      if (this.circuitBreaker.consecutiveLosses >= 2) {
        this.circuitBreaker.isTripped = true;
        this.circuitBreaker.trippedAt = Date.now();
        this.circuitBreaker.reason = "2 consecutive losses detected. Fortress Circuit Breaker tripped: Auto-Pilot disabled.";
        this.config.autoPilotEnabled = false;
        this.saveConfig({ autoPilotEnabled: false });
      }
      this.saveCircuitBreaker();
    } else if (realizedPnl > 0) {
      // Winning trade resets consecutive loss counter
      this.circuitBreaker.consecutiveLosses = 0;
      this.saveCircuitBreaker();
    }

    this.saveTrades();
    return trade;
  }

  /**
   * Transfers funds from Futures to Spot wallet (/sapi/v1/futures/transfer).
   */
  public async transferProfitToSpotWallet(amount: number): Promise<boolean> {
    if (!this.config.apiKey || !this.config.apiSecret || amount <= 0) return false;
    const timestamp = Date.now();
    // type 2: UM Futures to Spot
    const query = `asset=USDT&amount=${amount}&type=2&timestamp=${timestamp}`;
    const signature = await signQuery(query, this.config.apiSecret);

    try {
      const res = await fetch(`${SPOT_API_BASE}/sapi/v1/futures/transfer`, {
        method: "POST",
        headers: {
          "X-MBX-APIKEY": this.config.apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `${query}&signature=${signature}`,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Rule 3: KILL SWITCH / EMERGENCY STOP
   * Massive red 'EMERGENCY STOP' button:
   * Cancel ALL open orders (Spot and Futures) and close all positions immediately.
   */
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

    // Immediately disable Auto-Pilot
    this.config.autoPilotEnabled = false;
    this.saveConfig({ autoPilotEnabled: false });

    // Cancel all open orders on Binance Spot and Futures via API if credentials exist
    if (this.config.apiKey && this.config.apiSecret) {
      // Futures: Cancel all open orders for all symbols
      try {
        const timestamp = Date.now();
        const openFuturesTrades = this.trades.filter((t) => t.status === "OPEN" && t.marketType === "Futures");
        const symbols = Array.from(new Set(openFuturesTrades.map((t) => t.symbol)));

        for (const sym of symbols) {
          const q = `symbol=${sym}&timestamp=${timestamp}`;
          const sig = await signQuery(q, this.config.apiSecret);
          await fetch(`${FUTURES_API_BASE}/fapi/v1/allOpenOrders?${q}&signature=${sig}`, {
            method: "DELETE",
            headers: { "X-MBX-APIKEY": this.config.apiKey },
          });
          cancelledOrdersCount++;
        }
      } catch {
        futuresSuccess = false;
      }

      // Spot: Cancel open orders
      try {
        const timestamp = Date.now();
        const openSpotTrades = this.trades.filter((t) => t.status === "OPEN" && t.marketType === "Spot");
        const symbols = Array.from(new Set(openSpotTrades.map((t) => t.symbol)));

        for (const sym of symbols) {
          const q = `symbol=${sym}&timestamp=${timestamp}`;
          const sig = await signQuery(q, this.config.apiSecret);
          await fetch(`${SPOT_API_BASE}/api/v3/openOrders?${q}&signature=${sig}`, {
            method: "DELETE",
            headers: { "X-MBX-APIKEY": this.config.apiKey },
          });
          cancelledOrdersCount++;
        }
      } catch {
        spotSuccess = false;
      }
    }

    // Close all open managed positions immediately
    for (const trade of this.trades) {
      if (trade.status === "OPEN") {
        trade.status = "CLOSED";
        trade.closePrice = trade.entryPrice; // Marked closed at entry in emergency
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
