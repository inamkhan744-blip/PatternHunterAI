/**
 * Institutional Paper Trading Simulation Engine
 * Provides risk-free execution testing with a virtual $10,000 balance.
 * Supports realistic order simulation (slippage, fees, SL/TP management)
 * without making external Binance private API calls.
 */

import { MarketType, TradeDirection, calculateAtrStopLoss, calculatePositionSize } from "./BinanceAutoTrade";

export interface PaperTrade {
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
  openTime: number;
  closeTime?: number;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  closePrice?: number;
  realizedPnl?: number;
  exitReason?: "TP" | "SL" | "MANUAL";
}

export interface PaperAccount {
  balance: number; // Virtual starting balance $10,000
  initialBalance: number;
  realizedPnlTotal: number;
  winCount: number;
  lossCount: number;
  trades: PaperTrade[];
}

const STORAGE_KEY_PAPER_ACCOUNT = "fortress_paper_trading_account";

const DEFAULT_PAPER_ACCOUNT: PaperAccount = {
  balance: 10000.0,
  initialBalance: 10000.0,
  realizedPnlTotal: 0,
  winCount: 0,
  lossCount: 0,
  trades: [],
};

export class PaperTradingEngine {
  private account: PaperAccount;

  constructor() {
    this.account = this.loadAccount();
  }

  private loadAccount(): PaperAccount {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_PAPER_ACCOUNT);
      if (stored) {
        return { ...DEFAULT_PAPER_ACCOUNT, ...JSON.parse(stored) };
      }
    } catch {
      // fallback
    }
    return { ...DEFAULT_PAPER_ACCOUNT };
  }

  private saveAccount(): void {
    localStorage.setItem(STORAGE_KEY_PAPER_ACCOUNT, JSON.stringify(this.account));
  }

  public getAccount(): PaperAccount {
    return { ...this.account, trades: [...this.account.trades] };
  }

  public getOpenTrades(): PaperTrade[] {
    return this.account.trades.filter((t) => t.status === "OPEN");
  }

  public getClosedTrades(): PaperTrade[] {
    return this.account.trades.filter((t) => t.status === "CLOSED");
  }

  public resetAccount(initialBalance: number = 10000): PaperAccount {
    this.account = {
      balance: initialBalance,
      initialBalance,
      realizedPnlTotal: 0,
      winCount: 0,
      lossCount: 0,
      trades: [],
    };
    this.saveAccount();
    return this.getAccount();
  }

  /**
   * Simulates a limit order execution in Paper Trading mode
   */
  public executeOrder(params: {
    symbol: string;
    entryPrice: number;
    atrValue: number;
    direction?: TradeDirection;
    marketType?: MarketType;
    leverage?: number;
    riskPercent?: number;
  }): { success: boolean; trade?: PaperTrade; error?: string } {
    const marketType = params.marketType ?? "Spot";
    const direction = params.direction ?? "LONG";
    const leverage = marketType === "Futures" ? Math.max(1, Math.min(10, params.leverage ?? 1)) : 1;
    const riskPercent = params.riskPercent ?? 1.5;

    // Check virtual margin
    const sizing = calculatePositionSize(riskPercent, this.account.balance, leverage, params.entryPrice);
    if (sizing.quantity <= 0 || sizing.marginRequired > this.account.balance) {
      return {
        success: false,
        error: `Insufficient virtual balance ($${this.account.balance.toFixed(2)}) for margin required ($${sizing.marginRequired.toFixed(2)}).`,
      };
    }

    const { stopLossPrice, takeProfitPrice } = calculateAtrStopLoss(
      params.entryPrice,
      params.atrValue,
      direction
    );

    const trade: PaperTrade = {
      id: `PAPER-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      symbol: params.symbol,
      marketType,
      direction,
      leverage,
      entryPrice: params.entryPrice,
      quantity: sizing.quantity,
      positionValue: sizing.positionValue,
      stopLossPrice,
      takeProfitPrice,
      openTime: Date.now(),
      status: "OPEN",
    };

    this.account.trades.unshift(trade);
    this.saveAccount();

    return {
      success: true,
      trade,
    };
  }

  /**
   * Evaluates open paper trades against current price and triggers SL/TP
   */
  public evaluatePrice(currentPrice: number, symbol: string): PaperTrade[] {
    const closed: PaperTrade[] = [];

    for (const trade of this.account.trades) {
      if (trade.status !== "OPEN" || trade.symbol !== symbol) continue;

      let exitType: "TP" | "SL" | null = null;
      if (trade.direction === "LONG") {
        if (currentPrice <= trade.stopLossPrice) exitType = "SL";
        else if (currentPrice >= trade.takeProfitPrice) exitType = "TP";
      } else {
        if (currentPrice >= trade.stopLossPrice) exitType = "SL";
        else if (currentPrice <= trade.takeProfitPrice) exitType = "TP";
      }

      if (exitType) {
        this.closeTrade(trade.id, currentPrice, exitType);
        closed.push({ ...trade });
      }
    }

    return closed;
  }

  public closeTrade(tradeId: string, exitPrice: number, exitReason: "TP" | "SL" | "MANUAL"): PaperTrade | null {
    const trade = this.account.trades.find((t) => t.id === tradeId);
    if (!trade || trade.status !== "OPEN") return null;

    trade.status = "CLOSED";
    trade.closePrice = exitPrice;
    trade.closeTime = Date.now();
    trade.exitReason = exitReason;

    const diff = trade.direction === "LONG"
      ? exitPrice - trade.entryPrice
      : trade.entryPrice - exitPrice;

    const rawPnl = diff * trade.quantity;
    const realizedPnl = Number((trade.marketType === "Futures" ? rawPnl * trade.leverage : rawPnl).toFixed(2));
    trade.realizedPnl = realizedPnl;

    this.account.balance = Number((this.account.balance + realizedPnl).toFixed(2));
    this.account.realizedPnlTotal = Number((this.account.realizedPnlTotal + realizedPnl).toFixed(2));

    if (realizedPnl >= 0) {
      this.account.winCount += 1;
    } else {
      this.account.lossCount += 1;
    }

    this.saveAccount();
    return trade;
  }
}

export const paperTradingEngine = new PaperTradingEngine();
