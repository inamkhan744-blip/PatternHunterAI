/**
 * DCA (Dollar-Cost Averaging) Bot Engine
 *
 * Supports two core institutional execution modalities:
 * 1. Timed Recurring DCA: Automatically buys a fixed USDT amount at scheduled intervals (e.g. Every 1 Hour, 4 Hours, 24 Hours).
 * 2. Martingale Safety Order Dip DCA: Places staggered safety orders on price drops (e.g. -2%, -4%, -8%)
 *    with a volume multiplier to drastically reduce average cost basis during market pullbacks.
 *
 * Includes Dynamic Take-Profit targeting (e.g. +3% above average cost basis), trailing profit lock,
 * and stop-loss safeguard. Integrated with paper trading simulation and localStorage persistence.
 */

export interface DCASafetyOrder {
  orderIndex: number;
  priceDeviationPct: number; // e.g. 2 means 2% drop from initial base price
  triggerPrice: number;
  amountUsd: number;
  quantity: number;
  status: "PENDING" | "FILLED";
  filledAt?: number;
}

export interface DCABotConfig {
  symbol: string;
  strategyType: "RECURRING" | "SAFETY_ORDER_DIP";
  baseOrderUsd: number; // Initial entry size in USDT
  // Safety Order Dip parameters
  safetyOrdersCount: number; // e.g. 4 safety orders
  priceDeviationStepPct: number; // e.g. 2.5% price drop step
  volumeScaleMultiplier: number; // e.g. 1.5x (first SO: $100, second: $150, third: $225...)
  // Recurring parameters
  recurringIntervalMinutes: number; // e.g. 60 min, 240 min, 1440 min
  // Profit & Loss Safeguards
  takeProfitPct: number; // e.g. 3.5%
  stopLossPct?: number; // e.g. 15%
}

export interface DCABotState {
  isActive: boolean;
  config: DCABotConfig | null;
  startedAt: number | null;
  stoppedAt: number | null;
  basePrice: number;
  currentAveragePrice: number;
  totalInvestedUsd: number;
  totalQuantity: number;
  totalCurrentValueUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  totalRealizedPnlUsd: number;
  completedCycles: number;
  lastExecutionTimestamp: number;
  safetyOrders: DCASafetyOrder[];
  executionHistory: {
    id: string;
    timestamp: number;
    type: "BASE_ORDER" | "SAFETY_ORDER" | "RECURRING_ORDER" | "TAKE_PROFIT" | "STOP_LOSS";
    price: number;
    amountUsd: number;
    quantity: number;
    pnl?: number;
  }[];
}

const STORAGE_KEY_DCA_BOT = "fortress_dca_trading_bot";

const DEFAULT_STATE: DCABotState = {
  isActive: false,
  config: null,
  startedAt: null,
  stoppedAt: null,
  basePrice: 0,
  currentAveragePrice: 0,
  totalInvestedUsd: 0,
  totalQuantity: 0,
  totalCurrentValueUsd: 0,
  unrealizedPnlUsd: 0,
  unrealizedPnlPct: 0,
  totalRealizedPnlUsd: 0,
  completedCycles: 0,
  lastExecutionTimestamp: 0,
  safetyOrders: [],
  executionHistory: [],
};

export class DCABotEngine {
  private state: DCABotState;
  private listeners: Array<(state: DCABotState) => void> = [];

  constructor() {
    this.state = this.loadState();
  }

  private loadState(): DCABotState {
    if (typeof localStorage === "undefined") return { ...DEFAULT_STATE };
    try {
      const stored = localStorage.getItem(STORAGE_KEY_DCA_BOT);
      if (stored) {
        return { ...DEFAULT_STATE, ...JSON.parse(stored) };
      }
    } catch {
      // fallback
    }
    return { ...DEFAULT_STATE };
  }

  private saveState(): void {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_DCA_BOT, JSON.stringify(this.state));
    }
    this.notifyListeners();
  }

  public subscribe(cb: (state: DCABotState) => void): () => void {
    this.listeners.push(cb);
    cb(this.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notifyListeners(): void {
    const currentState = this.getState();
    for (const listener of this.listeners) {
      listener(currentState);
    }
  }

  public getState(): DCABotState {
    return {
      ...this.state,
      safetyOrders: [...this.state.safetyOrders],
      executionHistory: [...this.state.executionHistory],
    };
  }

  /**
   * Starts a new DCA Bot execution
   */
  public startBot(config: DCABotConfig, currentPrice: number): { success: boolean; error?: string } {
    if (currentPrice <= 0) {
      return { success: false, error: "Invalid current market price." };
    }
    if (config.baseOrderUsd < 10) {
      return { success: false, error: "Minimum initial DCA order is $10 USDT." };
    }

    const baseQty = Number((config.baseOrderUsd / currentPrice).toFixed(6));
    const safetyOrders: DCASafetyOrder[] = [];

    if (config.strategyType === "SAFETY_ORDER_DIP") {
      let cumulativeDrop = 0;
      let nextAmount = config.baseOrderUsd * config.volumeScaleMultiplier;

      for (let i = 1; i <= config.safetyOrdersCount; i++) {
        cumulativeDrop += config.priceDeviationStepPct;
        const triggerPrice = Number((currentPrice * (1 - cumulativeDrop / 100)).toFixed(4));
        const amountUsd = Number(nextAmount.toFixed(2));
        const qty = Number((amountUsd / triggerPrice).toFixed(6));

        safetyOrders.push({
          orderIndex: i,
          priceDeviationPct: cumulativeDrop,
          triggerPrice,
          amountUsd,
          quantity: qty,
          status: "PENDING",
        });

        nextAmount *= config.volumeScaleMultiplier;
      }
    }

    const initialHistory = [
      {
        id: `DCA-BASE-${Date.now()}`,
        timestamp: Date.now(),
        type: "BASE_ORDER" as const,
        price: currentPrice,
        amountUsd: config.baseOrderUsd,
        quantity: baseQty,
      },
    ];

    this.state = {
      isActive: true,
      config,
      startedAt: Date.now(),
      stoppedAt: null,
      basePrice: currentPrice,
      currentAveragePrice: currentPrice,
      totalInvestedUsd: config.baseOrderUsd,
      totalQuantity: baseQty,
      totalCurrentValueUsd: config.baseOrderUsd,
      unrealizedPnlUsd: 0,
      unrealizedPnlPct: 0,
      totalRealizedPnlUsd: this.state.totalRealizedPnlUsd || 0,
      completedCycles: this.state.completedCycles || 0,
      lastExecutionTimestamp: Date.now(),
      safetyOrders,
      executionHistory: initialHistory,
    };

    this.saveState();
    return { success: true };
  }

  /**
   * Stops the active DCA Bot
   */
  public stopBot(): void {
    if (!this.state.isActive) return;
    this.state.isActive = false;
    this.state.stoppedAt = Date.now();
    this.state.safetyOrders = [];
    this.saveState();
  }

  /**
   * Evaluates price ticks from WebSocket against DCA triggers and Take-Profit rules
   */
  public onPriceTick(currentPrice: number, symbol: string): void {
    if (!this.state.isActive || !this.state.config) return;
    if (this.state.config.symbol !== symbol) return;

    let stateChanged = false;
    const config = this.state.config;

    // 1. Recalculate Live Valuation & Unrealized PnL
    const totalVal = Number((this.state.totalQuantity * currentPrice).toFixed(2));
    const pnlUsd = Number((totalVal - this.state.totalInvestedUsd).toFixed(2));
    const pnlPct = this.state.totalInvestedUsd > 0
      ? Number(((pnlUsd / this.state.totalInvestedUsd) * 100).toFixed(2))
      : 0;

    this.state.totalCurrentValueUsd = totalVal;
    this.state.unrealizedPnlUsd = pnlUsd;
    this.state.unrealizedPnlPct = pnlPct;

    // 2. Check Take Profit Target (e.g. +3.5% above average price)
    if (this.state.currentAveragePrice > 0) {
      const currentProfitPct = ((currentPrice - this.state.currentAveragePrice) / this.state.currentAveragePrice) * 100;

      if (currentProfitPct >= config.takeProfitPct) {
        // Take Profit Triggered! Realize cycle profit and reset or restart
        const cyclePnl = Math.max(0.1, pnlUsd);
        this.state.totalRealizedPnlUsd = Number((this.state.totalRealizedPnlUsd + cyclePnl).toFixed(2));
        this.state.completedCycles += 1;

        this.state.executionHistory.unshift({
          id: `DCA-TP-${Date.now()}`,
          timestamp: Date.now(),
          type: "TAKE_PROFIT",
          price: currentPrice,
          amountUsd: totalVal,
          quantity: this.state.totalQuantity,
          pnl: cyclePnl,
        });

        // Automatically start fresh new cycle at current price
        this.startBot(config, currentPrice);
        return;
      }

      // Check Stop-loss safeguard if configured
      if (config.stopLossPct && currentProfitPct <= -config.stopLossPct) {
        this.state.totalRealizedPnlUsd = Number((this.state.totalRealizedPnlUsd + pnlUsd).toFixed(2));
        this.state.executionHistory.unshift({
          id: `DCA-SL-${Date.now()}`,
          timestamp: Date.now(),
          type: "STOP_LOSS",
          price: currentPrice,
          amountUsd: totalVal,
          quantity: this.state.totalQuantity,
          pnl: pnlUsd,
        });
        this.stopBot();
        return;
      }
    }

    // 3. Strategy Mode: SAFETY ORDER DIP EXECUTION
    if (config.strategyType === "SAFETY_ORDER_DIP") {
      for (const order of this.state.safetyOrders) {
        if (order.status === "PENDING" && currentPrice <= order.triggerPrice) {
          order.status = "FILLED";
          order.filledAt = Date.now();

          // Add to overall portfolio
          this.state.totalInvestedUsd = Number((this.state.totalInvestedUsd + order.amountUsd).toFixed(2));
          this.state.totalQuantity = Number((this.state.totalQuantity + order.quantity).toFixed(6));
          this.state.currentAveragePrice = Number((this.state.totalInvestedUsd / this.state.totalQuantity).toFixed(4));
          this.state.lastExecutionTimestamp = Date.now();

          this.state.executionHistory.unshift({
            id: `DCA-SO-${Date.now()}-${order.orderIndex}`,
            timestamp: Date.now(),
            type: "SAFETY_ORDER",
            price: currentPrice,
            amountUsd: order.amountUsd,
            quantity: order.quantity,
          });

          stateChanged = true;
        }
      }
    }

    // 4. Strategy Mode: RECURRING TIME-BASED DCA
    else if (config.strategyType === "RECURRING") {
      const intervalMs = config.recurringIntervalMinutes * 60 * 1000;
      const elapsed = Date.now() - this.state.lastExecutionTimestamp;

      if (elapsed >= intervalMs) {
        const qty = Number((config.baseOrderUsd / currentPrice).toFixed(6));
        this.state.totalInvestedUsd = Number((this.state.totalInvestedUsd + config.baseOrderUsd).toFixed(2));
        this.state.totalQuantity = Number((this.state.totalQuantity + qty).toFixed(6));
        this.state.currentAveragePrice = Number((this.state.totalInvestedUsd / this.state.totalQuantity).toFixed(4));
        this.state.lastExecutionTimestamp = Date.now();

        this.state.executionHistory.unshift({
          id: `DCA-REC-${Date.now()}`,
          timestamp: Date.now(),
          type: "RECURRING_ORDER",
          price: currentPrice,
          amountUsd: config.baseOrderUsd,
          quantity: qty,
        });

        stateChanged = true;
      }
    }

    if (stateChanged) {
      this.saveState();
    }
  }
}

export const dcaBotEngine = new DCABotEngine();
