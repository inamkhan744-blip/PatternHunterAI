/**
 * TradeManager.ts
 *
 * Centralized trade management utility for PatternHunter AI / Fortress Hedge Fund.
 * Persists active positions and closed trade history to localStorage.
 * Dispatches updates to any subscribed components (live React state).
 */

import { MarketType, TradeDirection } from "./BinanceAutoTrade";
import { pushNotificationService } from "./PushNotification";

export interface ActiveTrade {
  id: string;
  symbol: string;
  marketType: MarketType;
  direction: TradeDirection;
  leverage: number;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  notionalValue: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  initialStopLoss: number;
  atrAtEntry?: number;
  peakPrice?: number;
  troughPrice?: number;
  trailingStage?: "INITIAL" | "BREAK_EVEN" | "TRAILING_ATR";
  slOrderId?: string;
  tpOrderId?: string;
  source: "MANUAL" | "AUTO-PILOT";
  mode: "REAL" | "PAPER";
  openTime: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  isStuck?: boolean;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  marketType: MarketType;
  direction: TradeDirection;
  leverage: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  notionalValue: number;
  realizedPnl: number;
  realizedPnlPercent: number;
  exitReason: "MANUAL" | "TP" | "SL" | "KILL_SWITCH";
  source: "MANUAL" | "AUTO-PILOT";
  mode: "REAL" | "PAPER";
  openTime: number;
  closeTime: number;
  ocoStatus?: "SL_CANCELLED" | "TP_CANCELLED" | "NONE";
}

export interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
}

const STORAGE_KEY_ACTIVE_TRADES = "fortress_active_positions";
const STORAGE_KEY_TRADE_HISTORY = "fortress_trade_history";

type TradeListener = () => void;

class TradeManager {
  private activeTrades: ActiveTrade[] = [];
  private tradeHistory: ClosedTrade[] = [];
  private listeners: Set<TradeListener> = new Set();

  constructor() {
    this.loadState();
  }

  private loadState(): void {
    if (typeof localStorage === "undefined") {
      this.activeTrades = [];
      this.tradeHistory = [];
      return;
    }

    try {
      const activeRaw = localStorage.getItem(STORAGE_KEY_ACTIVE_TRADES);
      if (activeRaw) {
        this.activeTrades = JSON.parse(activeRaw);
      }
    } catch {
      this.activeTrades = [];
    }

    try {
      const historyRaw = localStorage.getItem(STORAGE_KEY_TRADE_HISTORY);
      if (historyRaw) {
        this.tradeHistory = JSON.parse(historyRaw);
      }
    } catch {
      this.tradeHistory = [];
    }
  }

  private saveState(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_TRADES, JSON.stringify(this.activeTrades));
      localStorage.setItem(STORAGE_KEY_TRADE_HISTORY, JSON.stringify(this.tradeHistory));
    } catch {
      // ignore
    }
    this.notify();
  }

  public subscribe(listener: TradeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore listener errors
      }
    });
  }

  public getActiveTrades(): ActiveTrade[] {
    return [...this.activeTrades];
  }

  public hasActivePosition(symbol: string): boolean {
    return this.activeTrades.some((t) => t.symbol === symbol);
  }

  public checkStuckTrades(timeoutMs: number = 24 * 60 * 60 * 1000): ActiveTrade[] {
    const now = Date.now();
    const stuckTrades: ActiveTrade[] = [];
    let updated = false;

    this.activeTrades = this.activeTrades.map((trade) => {
      const durationMs = now - trade.openTime;
      if (durationMs > timeoutMs) {
        if (!trade.isStuck) {
          const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(1);
          console.warn(`[STUCK TRADE TIMEOUT] Trade ${trade.id} for ${trade.symbol} has been open for ${durationHours} hours without hitting SL/TP. Allowing other symbols to trade.`);
          trade = { ...trade, isStuck: true };
          updated = true;
        }
        stuckTrades.push(trade);
      }
      return trade;
    });

    if (updated) {
      this.saveState();
    }

    return stuckTrades;
  }

  public getTradeHistory(): ClosedTrade[] {
    return [...this.tradeHistory];
  }

  public getStats(): TradeStats {
    const total = this.tradeHistory.length;
    let wins = 0;
    let losses = 0;
    let totalPnl = 0;

    for (const t of this.tradeHistory) {
      totalPnl += t.realizedPnl;
      if (t.realizedPnl >= 0) {
        wins++;
      } else {
        losses++;
      }
    }

    const winRate = total > 0 ? (wins / total) * 100 : 0;
    return {
      totalTrades: total,
      wins,
      losses,
      winRate: Number(winRate.toFixed(1)),
      totalPnl: Number(totalPnl.toFixed(2)),
    };
  }

  public addTrade(params: {
    symbol: string;
    entryPrice: number;
    currentPrice?: number;
    quantity: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    atrAtEntry?: number;
    direction?: TradeDirection;
    marketType?: MarketType;
    leverage?: number;
    source?: "MANUAL" | "AUTO-PILOT";
    mode?: "REAL" | "PAPER";
    customId?: string;
    slOrderId?: string;
    tpOrderId?: string;
  }): ActiveTrade | null {
    // Strict Execution Lock: Check if an active position already exists for that specific symbol
    if (this.hasActivePosition(params.symbol)) {
      console.log(`Trade blocked: Active position exists for symbol ${params.symbol}.`);
      return null;
    }

    // Check stuck positions before evaluating limits
    this.checkStuckTrades();

    const direction = params.direction ?? "LONG";
    const marketType = params.marketType ?? "Spot";
    const leverage = marketType === "Futures" ? (params.leverage ?? 1) : 1;
    const currentPrice = params.currentPrice ?? params.entryPrice;
    const notionalValue = Number((params.entryPrice * params.quantity).toFixed(2));
    const sl = params.stopLossPrice ?? (direction === "LONG" ? params.entryPrice * 0.97 : params.entryPrice * 1.03);
    const tp = params.takeProfitPrice ?? (direction === "LONG" ? params.entryPrice * 1.06 : params.entryPrice * 0.94);

    const pnl = this.calculatePnl(params.entryPrice, currentPrice, params.quantity, direction, leverage, marketType);

    const newTrade: ActiveTrade = {
      id: params.customId || `TRD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      symbol: params.symbol,
      marketType,
      direction,
      leverage,
      entryPrice: params.entryPrice,
      currentPrice,
      quantity: params.quantity,
      notionalValue,
      stopLossPrice: sl,
      takeProfitPrice: tp,
      initialStopLoss: sl,
      atrAtEntry: params.atrAtEntry ?? params.entryPrice * 0.015,
      peakPrice: params.entryPrice,
      troughPrice: params.entryPrice,
      trailingStage: "INITIAL",
      slOrderId: params.slOrderId,
      tpOrderId: params.tpOrderId,
      source: params.source ?? "MANUAL",
      mode: params.mode ?? "REAL",
      openTime: Date.now(),
      unrealizedPnl: pnl.pnl,
      unrealizedPnlPercent: pnl.pnlPercent,
    };

    // Prepend to active trades
    this.activeTrades = [newTrade, ...this.activeTrades.filter((t) => t.id !== newTrade.id)];
    this.saveState();
    return newTrade;
  }

  public updateLivePrice(symbol: string, currentPrice: number): void {
    let changed = false;
    const toClose: { trade: ActiveTrade; reason: "TP" | "SL" }[] = [];

    this.activeTrades = this.activeTrades.map((trade) => {
      if (trade.symbol !== symbol) return trade;
      changed = true;

      // Update peak / trough prices
      let updatedPeak = trade.peakPrice ?? trade.entryPrice;
      let updatedTrough = trade.troughPrice ?? trade.entryPrice;
      if (trade.direction === "LONG") {
        updatedPeak = Math.max(updatedPeak, currentPrice);
      } else {
        updatedTrough = Math.min(updatedTrough, currentPrice);
      }

      // Trailing Stop Loss Logic:
      // Once price reaches 1:1 RR, move SL to break-even (entry price).
      // Then trail SL by 1.5x ATR from peak (for LONG) or trough (for SHORT).
      let currentSl = trade.stopLossPrice;
      let trailingStage = trade.trailingStage ?? "INITIAL";
      const initialRisk = Math.abs(trade.entryPrice - trade.initialStopLoss);
      const safeAtr = trade.atrAtEntry && trade.atrAtEntry > 0 ? trade.atrAtEntry : trade.entryPrice * 0.015;
      const trailDistance = 1.5 * safeAtr;

      if (trade.direction === "LONG") {
        const reward = currentPrice - trade.entryPrice;
        if (initialRisk > 0 && reward >= initialRisk) {
          const dynamicTrail = updatedPeak - trailDistance;
          const targetSl = Math.max(trade.entryPrice, dynamicTrail);
          if (targetSl > currentSl) {
            currentSl = Number(targetSl.toFixed(4));
            trailingStage = targetSl > trade.entryPrice ? "TRAILING_ATR" : "BREAK_EVEN";
            pushNotificationService.notifyTrailingStopMoved({
              symbol: trade.symbol,
              newStopLoss: currentSl,
              stage: trailingStage,
            }).catch(() => {});
          }
        }
      } else {
        // SHORT
        const reward = trade.entryPrice - currentPrice;
        if (initialRisk > 0 && reward >= initialRisk) {
          const dynamicTrail = updatedTrough + trailDistance;
          const targetSl = Math.min(trade.entryPrice, dynamicTrail);
          if (targetSl < currentSl) {
            currentSl = Number(targetSl.toFixed(4));
            trailingStage = targetSl < trade.entryPrice ? "TRAILING_ATR" : "BREAK_EVEN";
            pushNotificationService.notifyTrailingStopMoved({
              symbol: trade.symbol,
              newStopLoss: currentSl,
              stage: trailingStage,
            }).catch(() => {});
          }
        }
      }

      const pnl = this.calculatePnl(
        trade.entryPrice,
        currentPrice,
        trade.quantity,
        trade.direction,
        trade.leverage,
        trade.marketType
      );

      // Check automated SL / TP triggers
      let reason: "TP" | "SL" | null = null;
      if (trade.direction === "LONG") {
        if (currentPrice <= currentSl) reason = "SL";
        else if (currentPrice >= trade.takeProfitPrice) reason = "TP";
      } else {
        if (currentPrice >= currentSl) reason = "SL";
        else if (currentPrice <= trade.takeProfitPrice) reason = "TP";
      }

      if (reason) {
        toClose.push({ trade: { ...trade, stopLossPrice: currentSl }, reason });
      }

      return {
        ...trade,
        currentPrice,
        stopLossPrice: currentSl,
        peakPrice: updatedPeak,
        troughPrice: updatedTrough,
        trailingStage,
        unrealizedPnl: pnl.pnl,
        unrealizedPnlPercent: pnl.pnlPercent,
      };
    });

    if (toClose.length > 0) {
      for (const item of toClose) {
        this.closeTrade(item.trade.id, currentPrice, item.reason);
      }
    } else if (changed) {
      this.saveState();
    }
  }

  public closeTrade(
    tradeId: string,
    exitPrice?: number,
    exitReason: "MANUAL" | "TP" | "SL" | "KILL_SWITCH" = "MANUAL"
  ): ClosedTrade | null {
    const trade = this.activeTrades.find((t) => t.id === tradeId);
    if (!trade) return null;

    const closePrice = exitPrice ?? trade.currentPrice;
    const pnl = this.calculatePnl(
      trade.entryPrice,
      closePrice,
      trade.quantity,
      trade.direction,
      trade.leverage,
      trade.marketType
    );

    // OCO Execution note: if Take Profit was hit, cancel corresponding Stop Loss
    let ocoStatus: "SL_CANCELLED" | "TP_CANCELLED" | "NONE" = "NONE";
    if (exitReason === "TP") {
      ocoStatus = "SL_CANCELLED";
    } else if (exitReason === "SL") {
      ocoStatus = "TP_CANCELLED";
    }

    const closed: ClosedTrade = {
      id: trade.id,
      symbol: trade.symbol,
      marketType: trade.marketType,
      direction: trade.direction,
      leverage: trade.leverage,
      entryPrice: trade.entryPrice,
      exitPrice: closePrice,
      quantity: trade.quantity,
      notionalValue: trade.notionalValue,
      realizedPnl: pnl.pnl,
      realizedPnlPercent: pnl.pnlPercent,
      exitReason,
      source: trade.source,
      mode: trade.mode,
      openTime: trade.openTime,
      closeTime: Date.now(),
      ocoStatus,
    };

    if (exitReason === "TP" || exitReason === "SL") {
      pushNotificationService.notifyOcoTriggered({
        symbol: trade.symbol,
        exitReason,
        exitPrice: closePrice,
        pnl: pnl.pnl,
      }).catch(() => {});
    }

    this.activeTrades = this.activeTrades.filter((t) => t.id !== tradeId);
    this.tradeHistory = [closed, ...this.tradeHistory];
    this.saveState();
    return closed;
  }

  public closeAllTrades(reason: "MANUAL" | "KILL_SWITCH" = "MANUAL"): number {
    const count = this.activeTrades.length;
    const list = [...this.activeTrades];
    for (const t of list) {
      this.closeTrade(t.id, t.currentPrice, reason);
    }
    return count;
  }

  private calculatePnl(
    entryPrice: number,
    currentPrice: number,
    quantity: number,
    direction: TradeDirection,
    leverage: number,
    marketType: MarketType
  ): { pnl: number; pnlPercent: number } {
    if (entryPrice <= 0) return { pnl: 0, pnlPercent: 0 };
    const diff = direction === "LONG" ? currentPrice - entryPrice : entryPrice - currentPrice;
    const rawPnl = diff * quantity;
    const mult = marketType === "Futures" ? leverage : 1;
    const pnl = Number((rawPnl * mult).toFixed(2));
    const pnlPercent = Number((((diff / entryPrice) * 100) * mult).toFixed(2));
    return { pnl, pnlPercent };
  }
}

export const tradeManager = new TradeManager();
