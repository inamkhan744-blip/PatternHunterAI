/**
 * Grid Trading Bot Engine (Optimized for Sideways / Ranging Markets)
 *
 * Implements arithmetic grid spacing between Lower Price and Upper Price.
 * Automatically distributes buy orders below current market price and
 * sell orders above current price. On fill, automatically places counter-order
 * to capture range arbitrage volatility.
 *
 * Fully integrated with Paper Trading simulation and local persistence.
 */

export interface GridOrder {
  id: string;
  gridIndex: number;
  price: number;
  side: "BUY" | "SELL";
  status: "PENDING" | "FILLED" | "CANCELLED";
  quantity: number;
  totalUsd: number;
  filledAt?: number;
  matchedOrderId?: string;
  realizedPnl?: number;
}

export interface GridBotConfig {
  symbol: string;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  investmentAmount: number; // in USDT
}

export interface GridBotState {
  isActive: boolean;
  config: GridBotConfig | null;
  startedAt: number | null;
  stoppedAt: number | null;
  grids: number[]; // All price levels sorted ascending
  activeOrders: GridOrder[];
  filledOrders: GridOrder[];
  totalRealizedPnl: number;
  totalArbitrageCycles: number;
  lastCheckedPrice: number;
}

const STORAGE_KEY_GRID_BOT = "fortress_grid_trading_bot";

const DEFAULT_STATE: GridBotState = {
  isActive: false,
  config: null,
  startedAt: null,
  stoppedAt: null,
  grids: [],
  activeOrders: [],
  filledOrders: [],
  totalRealizedPnl: 0,
  totalArbitrageCycles: 0,
  lastCheckedPrice: 0,
};

export class GridTradingBot {
  private state: GridBotState;
  private listeners: Array<(state: GridBotState) => void> = [];

  constructor() {
    this.state = this.loadState();
  }

  private loadState(): GridBotState {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_GRID_BOT);
      if (stored) {
        return { ...DEFAULT_STATE, ...JSON.parse(stored) };
      }
    } catch {
      // fallback
    }
    return { ...DEFAULT_STATE };
  }

  private saveState(): void {
    localStorage.setItem(STORAGE_KEY_GRID_BOT, JSON.stringify(this.state));
    this.notifyListeners();
  }

  public subscribe(cb: (state: GridBotState) => void): () => void {
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

  public getState(): GridBotState {
    return {
      ...this.state,
      grids: [...this.state.grids],
      activeOrders: [...this.state.activeOrders],
      filledOrders: [...this.state.filledOrders],
    };
  }

  /**
   * Generates arithmetic grid price levels between lower and upper bounds
   */
  public calculateGridLevels(lowerPrice: number, upperPrice: number, count: number): number[] {
    if (lowerPrice >= upperPrice || count < 2) return [];
    const levels: number[] = [];
    const step = (upperPrice - lowerPrice) / (count - 1);
    for (let i = 0; i < count; i++) {
      const price = Number((lowerPrice + step * i).toFixed(4));
      levels.push(price);
    }
    return levels;
  }

  /**
   * Starts the Grid Bot with the provided configuration and current market price
   */
  public startBot(config: GridBotConfig, currentPrice: number): { success: boolean; error?: string } {
    if (config.lowerPrice >= config.upperPrice) {
      return { success: false, error: "Upper Price must be strictly greater than Lower Price." };
    }
    if (currentPrice < config.lowerPrice || currentPrice > config.upperPrice) {
      return {
        success: false,
        error: `Current price ($${currentPrice.toFixed(2)}) is outside grid range [$${config.lowerPrice.toFixed(2)} - $${config.upperPrice.toFixed(2)}].`,
      };
    }
    if (config.gridCount < 3 || config.gridCount > 50) {
      return { success: false, error: "Number of grids must be between 3 and 50." };
    }
    if (config.investmentAmount < 10) {
      return { success: false, error: "Minimum simulated investment is $10 USDT." };
    }

    const gridLevels = this.calculateGridLevels(config.lowerPrice, config.upperPrice, config.gridCount);
    const amountPerGrid = config.investmentAmount / config.gridCount;

    const initialOrders: GridOrder[] = [];

    gridLevels.forEach((gridPrice, index) => {
      // If below market price -> BUY order
      // If above market price -> SELL order
      if (gridPrice < currentPrice) {
        const qty = Number((amountPerGrid / gridPrice).toFixed(6));
        initialOrders.push({
          id: `GRID-BUY-${Date.now()}-${index}`,
          gridIndex: index,
          price: gridPrice,
          side: "BUY",
          status: "PENDING",
          quantity: qty,
          totalUsd: amountPerGrid,
        });
      } else if (gridPrice > currentPrice) {
        const qty = Number((amountPerGrid / gridPrice).toFixed(6));
        initialOrders.push({
          id: `GRID-SELL-${Date.now()}-${index}`,
          gridIndex: index,
          price: gridPrice,
          side: "SELL",
          status: "PENDING",
          quantity: qty,
          totalUsd: amountPerGrid,
        });
      }
    });

    this.state = {
      isActive: true,
      config,
      startedAt: Date.now(),
      stoppedAt: null,
      grids: gridLevels,
      activeOrders: initialOrders,
      filledOrders: [],
      totalRealizedPnl: 0,
      totalArbitrageCycles: 0,
      lastCheckedPrice: currentPrice,
    };

    this.saveState();
    return { success: true };
  }

  /**
   * Stops the active grid bot
   */
  public stopBot(): void {
    if (!this.state.isActive) return;
    this.state.isActive = false;
    this.state.stoppedAt = Date.now();
    this.state.activeOrders = [];
    this.saveState();
  }

  /**
   * Evaluates price tick against open grid orders.
   * If price triggers buy/sell grid, order executes and counter order is created.
   */
  public onPriceTick(currentPrice: number, symbol: string): GridOrder[] {
    if (!this.state.isActive || !this.state.config) return [];
    if (this.state.config.symbol !== symbol) return [];

    const newlyFilled: GridOrder[] = [];
    const remainingOrders: GridOrder[] = [];
    const grids = this.state.grids;
    const amountPerGrid = this.state.config.investmentAmount / this.state.config.gridCount;

    for (const order of this.state.activeOrders) {
      let triggered = false;

      // Buy triggers when price drops to or below the grid level
      if (order.side === "BUY" && currentPrice <= order.price) {
        triggered = true;
      }
      // Sell triggers when price rises to or above the grid level
      else if (order.side === "SELL" && currentPrice >= order.price) {
        triggered = true;
      }

      if (triggered) {
        order.status = "FILLED";
        order.filledAt = Date.now();
        newlyFilled.push(order);
        this.state.filledOrders.unshift({ ...order });

        // Calculate single grid step spacing
        const gridStep = grids.length > 1 ? grids[1] - grids[0] : 0;

        if (order.side === "BUY") {
          // If we bought, place a counter SELL order one grid level above
          const nextIndex = Math.min(order.gridIndex + 1, grids.length - 1);
          const targetSellPrice = grids[nextIndex] || order.price + gridStep;
          const sellQty = order.quantity;

          const counterSell: GridOrder = {
            id: `GRID-SELL-${Date.now()}-${nextIndex}`,
            gridIndex: nextIndex,
            price: targetSellPrice,
            side: "SELL",
            status: "PENDING",
            quantity: sellQty,
            totalUsd: Number((sellQty * targetSellPrice).toFixed(2)),
            matchedOrderId: order.id,
          };
          remainingOrders.push(counterSell);
        } else {
          // If we sold, place a counter BUY order one grid level below
          const prevIndex = Math.max(order.gridIndex - 1, 0);
          const targetBuyPrice = grids[prevIndex] || order.price - gridStep;
          const buyQty = Number((amountPerGrid / targetBuyPrice).toFixed(6));

          // Realize grid arbitrage profit
          const profitPerUnit = order.price - (grids[order.gridIndex - 1] || order.price * 0.99);
          const cyclePnl = Math.max(0.1, Number((profitPerUnit * order.quantity).toFixed(2)));
          this.state.totalRealizedPnl = Number((this.state.totalRealizedPnl + cyclePnl).toFixed(2));
          this.state.totalArbitrageCycles += 1;
          order.realizedPnl = cyclePnl;

          const counterBuy: GridOrder = {
            id: `GRID-BUY-${Date.now()}-${prevIndex}`,
            gridIndex: prevIndex,
            price: targetBuyPrice,
            side: "BUY",
            status: "PENDING",
            quantity: buyQty,
            totalUsd: amountPerGrid,
            matchedOrderId: order.id,
          };
          remainingOrders.push(counterBuy);
        }
      } else {
        remainingOrders.push(order);
      }
    }

    if (newlyFilled.length > 0) {
      this.state.activeOrders = remainingOrders;
      this.state.lastCheckedPrice = currentPrice;
      this.saveState();
    }

    return newlyFilled;
  }
}

export const gridTradingBot = new GridTradingBot();
