/**
 * TradeManager.ts
 *
 * Centralized trade management for PatternHunter AI.
 *
 * - Supabase (`trades`) is the durable, cross-device source of truth.
 * - localStorage remains a read-through cache so the UI survives reloads and
 *   offline periods. Writes made while offline are queued and replayed.
 * - PAPER and REAL positions are tracked independently: a paper position must
 *   never block, mirror, or close a live position (and vice versa).
 * - P/L math treats `quantity` as the already-levered position size, so P/L is
 *   `priceDiff * quantity`. Leverage only affects the *percentage* (return on
 *   committed margin), never the absolute P/L.
 */

import { RealtimeChannel } from "@supabase/supabase-js";
import { MarketType, TradeDirection, proxyBinanceFetch } from "./BinanceAutoTrade";
import { isLiveTradingConfigured } from "./CredentialVault";
import { paperTradingEngine } from "./PaperTrading";
import { pushNotificationService } from "./PushNotification";
import { supabase } from "./supabase";

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
  /** Collateral committed (notional / leverage for futures). */
  marginRequired?: number;
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
  /** Set while a write is waiting in the offline queue. */
  syncPending?: boolean;
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
  syncPending?: boolean;
}

export interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
}

export interface SupabaseTradeRow {
  id: string;
  user_id?: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entry_price: number;
  exit_price?: number | null;
  status: "OPEN" | "CLOSED";
  pnl: number;
  pnl_percent?: number;
  quantity?: number;
  leverage?: number;
  market_type?: MarketType;
  stop_loss_price?: number | null;
  take_profit_price?: number | null;
  exit_reason?: "MANUAL" | "TP" | "SL" | "KILL_SWITCH" | null;
  source?: "MANUAL" | "AUTO-PILOT";
  is_paper: boolean;
  created_at: string;
  closed_at?: string | null;
}

const STORAGE_KEY_ACTIVE_TRADES = "fortress_active_positions";
const STORAGE_KEY_TRADE_HISTORY = "fortress_trade_history";
const STORAGE_KEY_SYNC_QUEUE = "fortress_trade_sync_queue_v2";
const MIGRATION_FLAG_PREFIX = "fortress_trades_migrated_";

const OPEN_TRADE_SYNC_INTERVAL_MS = 15_000;

type TradeListener = () => void;
type TradeMode = "REAL" | "PAPER";

interface QueuedWrite {
  id: string;
  payload: Record<string, unknown>;
  queuedAt: number;
}

export class TradeManager {
  private activeTrades: ActiveTrade[] = [];
  private tradeHistory: ClosedTrade[] = [];
  private listeners: Set<TradeListener> = new Set();
  private currentUserId: string | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private isSyncingWithSupabase = false;
  private syncQueue: QueuedWrite[] = [];
  private lastOpenTradeSyncAt = 0;
  private slSyncInFlight: Set<string> = new Set();
  private onlineHandlerAttached = false;

  constructor() {
    this.loadState();
    this.loadQueue();
  }

  // ---------------------------------------------------------------- state I/O

  private loadState(): void {
    if (typeof localStorage === "undefined") return;

    try {
      const activeRaw = localStorage.getItem(STORAGE_KEY_ACTIVE_TRADES);
      if (activeRaw) {
        const parsed = JSON.parse(activeRaw) as ActiveTrade[];
        if (Array.isArray(parsed)) {
          this.activeTrades = parsed
            .filter((t) => t && typeof t.id === "string" && Number(t.entryPrice) > 0)
            .map((t) => ({
              ...t,
              mode: t.mode === "PAPER" ? "PAPER" : "REAL",
              currentPrice: Number(t.currentPrice) > 0 ? t.currentPrice : t.entryPrice,
            }));
        }
      }
    } catch {
      this.activeTrades = [];
    }

    try {
      const historyRaw = localStorage.getItem(STORAGE_KEY_TRADE_HISTORY);
      if (historyRaw) {
        const parsed = JSON.parse(historyRaw) as ClosedTrade[];
        if (Array.isArray(parsed)) {
          this.tradeHistory = parsed.filter((t) => t && typeof t.id === "string");
        }
      }
    } catch {
      this.tradeHistory = [];
    }
  }

  /** Flushes any queued writes immediately (e.g. after regaining connectivity). */
  public async requestSyncNow(): Promise<void> {
    await this.flushSyncQueue();
    await this.fetchAndMergeSupabaseTrades();
  }

  private saveState(skipNotify: boolean = false): void {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_ACTIVE_TRADES, JSON.stringify(this.activeTrades));
        localStorage.setItem(STORAGE_KEY_TRADE_HISTORY, JSON.stringify(this.tradeHistory));
      } catch {
        // Quota / private mode — Supabase remains the durable store.
      }
    }
    if (!skipNotify) this.notify();
  }

  private loadQueue(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SYNC_QUEUE);
      if (!raw) return;
      const parsed = JSON.parse(raw) as QueuedWrite[];
      if (Array.isArray(parsed)) {
        this.syncQueue = parsed.filter((q) => q && q.id && q.payload);
      }
    } catch {
      this.syncQueue = [];
    }
  }

  private persistQueue(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY_SYNC_QUEUE, JSON.stringify(this.syncQueue));
    } catch {
      // ignore
    }
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

  // ------------------------------------------------------------- session sync

  /**
   * Initializes the user session: hydrates from Supabase, migrates legacy local
   * records once per user, replays any offline writes, then subscribes to Realtime.
   */
  public async initializeUser(userId: string | null): Promise<void> {
    if (!userId) {
      this.cleanupRealtime();
      this.currentUserId = null;
      return;
    }

    if (this.currentUserId === userId && this.realtimeChannel) {
      return;
    }

    const previousUser = this.currentUserId;
    this.currentUserId = userId;

    if (previousUser && previousUser !== userId) {
      // Never leak another account's cached trades into this session.
      this.activeTrades = [];
      this.tradeHistory = [];
      this.saveState(true);
    }

    this.attachOnlineHandler();
    await this.fetchAndMergeSupabaseTrades();
    await this.migrateLegacyLocalTrades(userId);
    await this.flushSyncQueue();
    this.setupRealtimeSubscription(userId);
  }

  public cleanupRealtime(): void {
    if (this.realtimeChannel) {
      try {
        this.realtimeChannel.unsubscribe();
      } catch {
        // ignore
      }
      this.realtimeChannel = null;
    }
  }

  private attachOnlineHandler(): void {
    if (this.onlineHandlerAttached || typeof window === "undefined") return;
    this.onlineHandlerAttached = true;
    window.addEventListener("online", () => {
      void this.flushSyncQueue();
    });
  }

  /**
   * Pulls every trade row for the signed-in user (RLS scopes the query) and merges
   * it into the local cache.
   */
  public async fetchAndMergeSupabaseTrades(): Promise<void> {
    if (!this.currentUserId || this.isSyncingWithSupabase) return;

    this.isSyncingWithSupabase = true;
    try {
      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .eq("user_id", this.currentUserId)
        .order("created_at", { ascending: false })
        .limit(1000);

      if (error) {
        // Offline or transient failure: keep local cache, queue stays intact.
        console.warn("[TradeManager] Failed to fetch trades from Supabase:", error.message);
        return;
      }
      if (!data) return;

      this.mergeRemoteTrades(data as SupabaseTradeRow[]);
    } catch (err) {
      console.warn("[TradeManager] Unexpected error syncing with Supabase:", err);
    } finally {
      this.isSyncingWithSupabase = false;
    }
  }

  /**
   * One-time, idempotent migration of pre-Supabase localStorage trades.
   * Upserts by id so re-running it can never duplicate records, and never deletes
   * rows that already exist in the database.
   */
  private async migrateLegacyLocalTrades(userId: string): Promise<void> {
    if (typeof localStorage === "undefined") return;
    const flagKey = `${MIGRATION_FLAG_PREFIX}${userId}`;
    try {
      if (localStorage.getItem(flagKey) === "done") return;
    } catch {
      return;
    }

    const records = [
      ...this.activeTrades.map((t) => this.openPayload(t, userId, t.mode === "PAPER")),
      ...this.tradeHistory.map((t) => this.closePayload(t, userId)),
    ];

    if (records.length === 0) {
      this.markMigrated(flagKey);
      return;
    }

    try {
      const { error } = await supabase.from("trades").upsert(records, { onConflict: "id" });
      if (error) throw new Error(error.message);
      this.markMigrated(flagKey);
    } catch (err) {
      // Leave the flag unset so the migration is retried on the next login.
      console.warn("[TradeManager] Legacy trade migration deferred:", err);
    }
  }

  private markMigrated(flagKey: string): void {
    try {
      localStorage.setItem(flagKey, "done");
    } catch {
      // ignore
    }
  }

  private mergeRemoteTrades(remoteRows: SupabaseTradeRow[]): void {
    const existingActiveMap = new Map(this.activeTrades.map((t) => [t.id, t]));
    const existingHistoryMap = new Map(this.tradeHistory.map((t) => [t.id, t]));

    for (const row of remoteRows) {
      if (!row || !row.id) continue;

      const mode: TradeMode = row.is_paper ? "PAPER" : "REAL";
      const marketType: MarketType = row.market_type === "Futures" ? "Futures" : "Spot";
      const direction: TradeDirection = row.direction === "SHORT" ? "SHORT" : "LONG";
      const leverage = Number(row.leverage) > 0 ? Number(row.leverage) : 1;
      const entryPrice = Number(row.entry_price);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;

      const quantity = Number(row.quantity) > 0 ? Number(row.quantity) : 0;
      const notionalValue = Number((entryPrice * quantity).toFixed(2));
      const openTime = row.created_at ? new Date(row.created_at).getTime() : Date.now();

      if (row.status === "OPEN") {
        if (existingHistoryMap.has(row.id)) continue;

        const existing = existingActiveMap.get(row.id);
        // A queued local write is newer than what the server still reports.
        if (existing?.syncPending) continue;

        const currentPrice = existing?.currentPrice ?? entryPrice;
        const sl =
          Number(row.stop_loss_price) > 0
            ? Number(row.stop_loss_price)
            : existing?.stopLossPrice ?? (direction === "LONG" ? entryPrice * 0.97 : entryPrice * 1.03);
        const tp =
          Number(row.take_profit_price) > 0
            ? Number(row.take_profit_price)
            : existing?.takeProfitPrice ?? (direction === "LONG" ? entryPrice * 1.06 : entryPrice * 0.94);
        const pnl = this.calculatePnl(entryPrice, currentPrice, quantity, direction, leverage, marketType);

        existingActiveMap.set(row.id, {
          id: row.id,
          symbol: row.symbol,
          marketType,
          direction,
          leverage,
          entryPrice,
          currentPrice,
          quantity,
          notionalValue,
          marginRequired: this.marginFor(notionalValue, leverage, marketType),
          stopLossPrice: sl,
          takeProfitPrice: tp,
          initialStopLoss: existing?.initialStopLoss ?? sl,
          atrAtEntry: existing?.atrAtEntry ?? entryPrice * 0.015,
          peakPrice: existing?.peakPrice ?? Math.max(entryPrice, currentPrice),
          troughPrice: existing?.troughPrice ?? Math.min(entryPrice, currentPrice),
          trailingStage: existing?.trailingStage ?? "INITIAL",
          slOrderId: existing?.slOrderId,
          tpOrderId: existing?.tpOrderId,
          source: row.source === "AUTO-PILOT" ? "AUTO-PILOT" : "MANUAL",
          mode,
          openTime: existing?.openTime ?? openTime,
          unrealizedPnl: pnl.pnl,
          unrealizedPnlPercent: pnl.pnlPercent,
          syncPending: false,
        });
      } else {
        existingActiveMap.delete(row.id);

        const closeTime = row.closed_at
          ? new Date(row.closed_at).getTime()
          : row.created_at
            ? new Date(row.created_at).getTime()
            : Date.now();
        const exitPrice = Number(row.exit_price) > 0 ? Number(row.exit_price) : entryPrice;

        existingHistoryMap.set(row.id, {
          id: row.id,
          symbol: row.symbol,
          marketType,
          direction,
          leverage,
          entryPrice,
          exitPrice,
          quantity,
          notionalValue,
          realizedPnl: Number(row.pnl ?? 0),
          realizedPnlPercent: Number(row.pnl_percent ?? 0),
          exitReason: row.exit_reason || "MANUAL",
          source: row.source === "AUTO-PILOT" ? "AUTO-PILOT" : "MANUAL",
          mode,
          openTime,
          closeTime,
          ocoStatus: "NONE",
          syncPending: false,
        });
      }
    }

    this.activeTrades = Array.from(existingActiveMap.values()).sort((a, b) => b.openTime - a.openTime);
    this.tradeHistory = Array.from(existingHistoryMap.values()).sort((a, b) => b.closeTime - a.closeTime);
    this.saveState();
  }

  private setupRealtimeSubscription(userId: string): void {
    this.cleanupRealtime();

    try {
      this.realtimeChannel = supabase
        .channel(`trades-sync-${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "trades", filter: `user_id=eq.${userId}` },
          (payload) => {
            this.handleRealtimePayload(payload as unknown as {
              eventType: "INSERT" | "UPDATE" | "DELETE" | string;
              new: Record<string, unknown>;
              old: Record<string, unknown>;
            });
          }
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // Realtime is best-effort; the queue + explicit refresh cover failures.
            console.warn("[TradeManager] Realtime channel unavailable — using polling fallback.");
          }
        });
    } catch (err) {
      console.warn("[TradeManager] Error subscribing to trades realtime channel:", err);
    }
  }

  public handleRealtimePayload(payload: {
    eventType: "INSERT" | "UPDATE" | "DELETE" | string;
    new: Record<string, unknown>;
    old: Record<string, unknown>;
  }): void {
    if (payload.eventType === "DELETE") {
      const oldId = payload.old?.id;
      if (typeof oldId === "string") {
        this.activeTrades = this.activeTrades.filter((t) => t.id !== oldId);
        this.tradeHistory = this.tradeHistory.filter((t) => t.id !== oldId);
        this.saveState();
      }
      return;
    }

    const row = payload.new as unknown as SupabaseTradeRow;
    if (!row || !row.id) return;
    this.mergeRemoteTrades([row]);
  }

  // ---------------------------------------------------------------- accessors

  public getActiveTrades(): ActiveTrade[] {
    return [...this.activeTrades];
  }

  /**
   * An execution lock is scoped to a symbol *and* a mode. A paper position must not
   * block a live trade on the same symbol, and vice versa.
   */
  public hasActivePosition(symbol: string, mode?: TradeMode): boolean {
    return this.activeTrades.some((t) => t.symbol === symbol && (mode ? t.mode === mode : true));
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
      if (t.realizedPnl >= 0) wins++;
      else losses++;
    }

    return {
      totalTrades: total,
      wins,
      losses,
      winRate: total > 0 ? Number(((wins / total) * 100).toFixed(1)) : 0,
      totalPnl: Number(totalPnl.toFixed(2)),
    };
  }

  public checkStuckTrades(timeoutMs: number = 24 * 60 * 60 * 1000): ActiveTrade[] {
    const now = Date.now();
    const stuckTrades: ActiveTrade[] = [];
    let updated = false;

    this.activeTrades = this.activeTrades.map((trade) => {
      if (now - trade.openTime > timeoutMs && !trade.isStuck) {
        console.warn(
          `[STUCK TRADE TIMEOUT] ${trade.symbol} (${trade.id}) open for ${((now - trade.openTime) / 3_600_000).toFixed(1)}h without hitting SL/TP.`
        );
        updated = true;
        const next = { ...trade, isStuck: true };
        stuckTrades.push(next);
        return next;
      }
      if (now - trade.openTime > timeoutMs) stuckTrades.push(trade);
      return trade;
    });

    if (updated) this.saveState();
    return stuckTrades;
  }

  // ----------------------------------------------------------------- mutation

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
    mode?: TradeMode;
    customId?: string;
    slOrderId?: string;
    tpOrderId?: string;
  }): ActiveTrade | null {
    if (!Number.isFinite(params.entryPrice) || params.entryPrice <= 0) return null;
    if (!Number.isFinite(params.quantity) || params.quantity <= 0) return null;

    const mode: TradeMode =
      params.mode ?? (isLiveTradingConfigured() ? "REAL" : "PAPER");

    // Strict execution lock, scoped to the same symbol *and* same execution mode.
    if (this.hasActivePosition(params.symbol, mode)) {
      console.log(`Trade blocked: active ${mode} position already exists for ${params.symbol}.`);
      return null;
    }

    this.checkStuckTrades();

    const direction = params.direction ?? "LONG";
    const marketType = params.marketType === "Futures" ? "Futures" : "Spot";
    const leverage = marketType === "Futures" ? Math.max(1, Math.min(10, params.leverage ?? 1)) : 1;
    const currentPrice = params.currentPrice ?? params.entryPrice;
    const notionalValue = Number((params.entryPrice * params.quantity).toFixed(2));
    const sl =
      params.stopLossPrice && params.stopLossPrice > 0
        ? params.stopLossPrice
        : direction === "LONG"
          ? params.entryPrice * 0.97
          : params.entryPrice * 1.03;
    const tp =
      params.takeProfitPrice && params.takeProfitPrice > 0
        ? params.takeProfitPrice
        : direction === "LONG"
          ? params.entryPrice * 1.06
          : params.entryPrice * 0.94;

    const pnl = this.calculatePnl(params.entryPrice, currentPrice, params.quantity, direction, leverage, marketType);
    const id = params.customId || `TRD-${Date.now()}-${Math.floor(Math.random() * 100_000)}`;

    // Idempotency: the same exchange order must never create two positions.
    if (this.activeTrades.some((t) => t.id === id)) {
      return this.activeTrades.find((t) => t.id === id) ?? null;
    }

    const newTrade: ActiveTrade = {
      id,
      symbol: params.symbol,
      marketType,
      direction,
      leverage,
      entryPrice: params.entryPrice,
      currentPrice,
      quantity: params.quantity,
      notionalValue,
      marginRequired: this.marginFor(notionalValue, leverage, marketType),
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
      mode,
      openTime: Date.now(),
      unrealizedPnl: pnl.pnl,
      unrealizedPnlPercent: pnl.pnlPercent,
      syncPending: true,
    };

    this.activeTrades = [newTrade, ...this.activeTrades];
    this.saveState();

    this.queueWrite(this.openPayload(newTrade, this.currentUserId, mode === "PAPER"));
    return newTrade;
  }

  public updateLivePrice(symbol: string, currentPrice: number): void {
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) return;

    let changed = false;
    const toClose: { trade: ActiveTrade; reason: "TP" | "SL" }[] = [];
    const slUpdates: { trade: ActiveTrade; newStop: number }[] = [];

    this.activeTrades = this.activeTrades.map((trade) => {
      if (trade.symbol !== symbol) return trade;
      changed = true;

      let updatedPeak = trade.peakPrice ?? trade.entryPrice;
      let updatedTrough = trade.troughPrice ?? trade.entryPrice;
      if (trade.direction === "LONG") updatedPeak = Math.max(updatedPeak, currentPrice);
      else updatedTrough = Math.min(updatedTrough, currentPrice);

      let currentSl = trade.stopLossPrice;
      let trailingStage = trade.trailingStage ?? "INITIAL";
      const initialRisk = Math.abs(trade.entryPrice - trade.initialStopLoss);
      const safeAtr = trade.atrAtEntry && trade.atrAtEntry > 0 ? trade.atrAtEntry : trade.entryPrice * 0.015;
      const trailDistance = 1.5 * safeAtr;

      if (trade.direction === "LONG") {
        const reward = currentPrice - trade.entryPrice;
        if (initialRisk > 0 && reward >= initialRisk) {
          const targetSl = Math.max(trade.entryPrice, updatedPeak - trailDistance);
          if (targetSl > currentSl) {
            currentSl = Number(targetSl.toFixed(4));
            trailingStage = targetSl > trade.entryPrice ? "TRAILING_ATR" : "BREAK_EVEN";
            slUpdates.push({ trade, newStop: currentSl });
          }
        }
      } else {
        const reward = trade.entryPrice - currentPrice;
        if (initialRisk > 0 && reward >= initialRisk) {
          const targetSl = Math.min(trade.entryPrice, updatedTrough + trailDistance);
          if (targetSl < currentSl) {
            currentSl = Number(targetSl.toFixed(4));
            trailingStage = targetSl < trade.entryPrice ? "TRAILING_ATR" : "BREAK_EVEN";
            slUpdates.push({ trade, newStop: currentSl });
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

      let reason: "TP" | "SL" | null = null;
      if (trade.direction === "LONG") {
        if (currentPrice <= currentSl) reason = "SL";
        else if (currentPrice >= trade.takeProfitPrice) reason = "TP";
      } else {
        if (currentPrice >= currentSl) reason = "SL";
        else if (currentPrice <= trade.takeProfitPrice) reason = "TP";
      }

      const next: ActiveTrade = {
        ...trade,
        currentPrice,
        stopLossPrice: currentSl,
        peakPrice: updatedPeak,
        troughPrice: updatedTrough,
        trailingStage,
        unrealizedPnl: pnl.pnl,
        unrealizedPnlPercent: pnl.pnlPercent,
      };

      if (reason) toClose.push({ trade: next, reason });
      return next;
    });

    for (const update of slUpdates) {
      pushNotificationService
        .notifyTrailingStopMoved({
          symbol: update.trade.symbol,
          newStopLoss: update.newStop,
          stage: update.trade.trailingStage === "TRAILING_ATR" ? "TRAILING_ATR" : "BREAK_EVEN",
        })
        .catch(() => {});
      void this.replaceExchangeStopLoss(update.trade, update.newStop);
    }

    if (toClose.length > 0) {
      for (const item of toClose) this.closeTrade(item.trade.id, currentPrice, item.reason);
    } else if (changed) {
      this.saveState();
      this.scheduleOpenTradeSync();
    }
  }

  public closeTrade(
    tradeId: string,
    exitPrice?: number,
    exitReason: "MANUAL" | "TP" | "SL" | "KILL_SWITCH" = "MANUAL"
  ): ClosedTrade | null {
    const trade = this.activeTrades.find((t) => t.id === tradeId);
    if (!trade) return null;

    const candidate = exitPrice ?? trade.currentPrice;
    const closePrice = Number.isFinite(candidate) && candidate > 0 ? candidate : trade.currentPrice;

    const pnl = this.calculatePnl(
      trade.entryPrice,
      closePrice,
      trade.quantity,
      trade.direction,
      trade.leverage,
      trade.marketType
    );

    let ocoStatus: "SL_CANCELLED" | "TP_CANCELLED" | "NONE" = "NONE";
    if (exitReason === "TP") ocoStatus = "SL_CANCELLED";
    else if (exitReason === "SL") ocoStatus = "TP_CANCELLED";

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
      syncPending: true,
    };

    if (exitReason === "TP" || exitReason === "SL") {
      pushNotificationService
        .notifyOcoTriggered({ symbol: trade.symbol, exitReason, exitPrice: closePrice, pnl: pnl.pnl })
        .catch(() => {});
    }

    // Cancel the sibling bracket order on the exchange (REAL positions only).
    if (trade.mode === "REAL" && isLiveTradingConfigured()) {
      if (exitReason === "TP" && trade.slOrderId) {
        void this.cancelExchangeOrder(trade.symbol, trade.slOrderId, trade.marketType);
      } else if (exitReason === "SL" && trade.tpOrderId) {
        void this.cancelExchangeOrder(trade.symbol, trade.tpOrderId, trade.marketType);
      }
    }

    this.activeTrades = this.activeTrades.filter((t) => t.id !== tradeId);
    this.tradeHistory = [closed, ...this.tradeHistory];
    this.saveState();

    // Settle the mirrored position in the paper account so the virtual balance and
    // win/loss counters stay in step with the trade history. Never touches Binance.
    if (trade.mode === "PAPER") {
      try {
        paperTradingEngine.closeTrade(
          trade.id,
          closePrice,
          exitReason === "TP" || exitReason === "SL" ? exitReason : "MANUAL"
        );
      } catch {
        // paper account is best-effort bookkeeping
      }
    }

    this.queueWrite(this.closePayload(closed, this.currentUserId));
    return closed;
  }

  public closeAllTrades(reason: "MANUAL" | "KILL_SWITCH" = "MANUAL", mode?: TradeMode): number {
    const targets = this.activeTrades.filter((t) => (mode ? t.mode === mode : true));
    let count = 0;
    for (const t of targets) {
      if (this.closeTrade(t.id, t.currentPrice, reason)) count++;
    }
    return count;
  }

  // -------------------------------------------------------------- supabase IO

  private openPayload(trade: ActiveTrade, userId: string | null, isPaper: boolean): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      entry_price: trade.entryPrice,
      status: "OPEN",
      pnl: trade.unrealizedPnl,
      pnl_percent: trade.unrealizedPnlPercent,
      quantity: trade.quantity,
      leverage: trade.leverage,
      market_type: trade.marketType,
      stop_loss_price: trade.stopLossPrice,
      take_profit_price: trade.takeProfitPrice,
      source: trade.source,
      is_paper: isPaper,
      created_at: new Date(trade.openTime).toISOString(),
    };
    if (userId) payload.user_id = userId;
    return payload;
  }

  private closePayload(closed: ClosedTrade, userId: string | null): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      id: closed.id,
      symbol: closed.symbol,
      direction: closed.direction,
      entry_price: closed.entryPrice,
      exit_price: closed.exitPrice,
      status: "CLOSED",
      pnl: closed.realizedPnl,
      pnl_percent: closed.realizedPnlPercent,
      quantity: closed.quantity,
      leverage: closed.leverage,
      market_type: closed.marketType,
      stop_loss_price: null,
      exit_reason: closed.exitReason,
      source: closed.source,
      is_paper: closed.mode === "PAPER",
      created_at: new Date(closed.openTime).toISOString(),
      closed_at: new Date(closed.closeTime).toISOString(),
    };
    if (userId) payload.user_id = userId;
    return payload;
  }

  /**
   * Writes are queued first so an offline close is never lost. The queue replays
   * on reconnect and is idempotent (upsert by primary key).
   */
  private queueWrite(payload: Record<string, unknown>): void {
    const id = String(payload.id ?? "");
    if (!id) return;

    if (!this.currentUserId) {
      // Not signed in: nothing to sync yet, local cache is enough.
      return;
    }

    this.syncQueue = [
      ...this.syncQueue.filter((q) => q.id !== id),
      { id, payload, queuedAt: Date.now() },
    ].slice(-200);
    this.persistQueue();
    void this.flushSyncQueue();
  }

  public async flushSyncQueue(): Promise<void> {
    if (!this.currentUserId || this.syncQueue.length === 0) return;
    // Let Supabase attach the session before writing.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) return;

    const pending = [...this.syncQueue];
    for (const item of pending) {
      try {
        const { error } = await supabase.from("trades").upsert(item.payload, { onConflict: "id" });
        if (error) throw new Error(error.message);
        this.syncQueue = this.syncQueue.filter((q) => q.id !== item.id);
        this.persistQueue();
        this.markSynced(item.id);
      } catch (err) {
        console.warn(`[TradeManager] Trade ${item.id} not synced yet (will retry):`, err);
        // Stop on the first failure: the queue order matters and the network is down.
        break;
      }
    }
    this.saveState();
  }

  private markSynced(id: string): void {
    const active = this.activeTrades.find((t) => t.id === id);
    if (active?.syncPending) {
      this.activeTrades = this.activeTrades.map((t) => (t.id === id ? { ...t, syncPending: false } : t));
    }
    const closed = this.tradeHistory.find((t) => t.id === id);
    if (closed?.syncPending) {
      this.tradeHistory = this.tradeHistory.map((t) => (t.id === id ? { ...t, syncPending: false } : t));
    }
  }

  /**
   * Publishes live unrealized P/L for open positions, throttled so a 4s price tick
   * does not turn into a write storm (and so Realtime does not echo continuously).
   */
  private scheduleOpenTradeSync(): void {
    if (!this.currentUserId) return;
    const now = Date.now();
    if (now - this.lastOpenTradeSyncAt < OPEN_TRADE_SYNC_INTERVAL_MS) return;
    this.lastOpenTradeSyncAt = now;

    for (const trade of this.activeTrades) {
      this.queueWrite(this.openPayload(trade, this.currentUserId, trade.mode === "PAPER"));
    }
  }

  // ------------------------------------------------------------ exchange side

  private async replaceExchangeStopLoss(trade: ActiveTrade, newStopPrice: number): Promise<void> {
    if (trade.mode !== "REAL" || trade.marketType !== "Futures") return;
    if (!isLiveTradingConfigured()) return;
    if (this.slSyncInFlight.has(trade.id)) return;
    if (!Number.isFinite(newStopPrice) || newStopPrice <= 0) return;

    this.slSyncInFlight.add(trade.id);
    try {
      if (trade.slOrderId) {
        const cancelled = await this.cancelExchangeOrder(trade.symbol, trade.slOrderId, "Futures");
        if (!cancelled) return;
      }

      const body = [
        `symbol=${trade.symbol}`,
        `side=${trade.direction === "LONG" ? "SELL" : "BUY"}`,
        "type=STOP_MARKET",
        `stopPrice=${newStopPrice}`,
        "closePosition=true",
      ].join("&");

      const res = await proxyBinanceFetch({ target: "futures", path: "/fapi/v1/order", method: "POST", body });
      if (!res.ok) return;

      const data = await res.json().catch(() => ({}));
      if (data?.orderId) {
        this.activeTrades = this.activeTrades.map((t) =>
          t.id === trade.id ? { ...t, slOrderId: String(data.orderId) } : t
        );
        this.saveState(true);
        this.queueWrite(
          this.openPayload(
            this.activeTrades.find((t) => t.id === trade.id) ?? trade,
            this.currentUserId,
            false
          )
        );
      }
    } catch {
      // Local stop remains authoritative until the next successful sync.
    } finally {
      this.slSyncInFlight.delete(trade.id);
    }
  }

  /**
   * Closes a REAL position on Binance before it is recorded as closed locally.
   * PAPER positions short-circuit: they never touch the exchange.
   */
  public async closeTradeWithExchange(
    tradeId: string,
    exitPrice?: number,
    exitReason: "MANUAL" | "TP" | "SL" | "KILL_SWITCH" = "MANUAL"
  ): Promise<{ closed: ClosedTrade | null; error?: string }> {
    const trade = this.activeTrades.find((t) => t.id === tradeId);
    if (!trade) return { closed: null, error: "Position not found." };

    if (trade.mode === "REAL") {
      if (!isLiveTradingConfigured()) {
        return {
          closed: null,
          error: "Cannot close a live position: Binance credentials are not configured in the vault.",
        };
      }

      const body =
        trade.marketType === "Futures"
          ? [
              `symbol=${trade.symbol}`,
              `side=${trade.direction === "LONG" ? "SELL" : "BUY"}`,
              "type=MARKET",
              `quantity=${trade.quantity}`,
              "reduceOnly=true",
            ].join("&")
          : [
              `symbol=${trade.symbol}`,
              "side=SELL",
              "type=MARKET",
              `quantity=${trade.quantity}`,
            ].join("&");

      try {
        const res = await proxyBinanceFetch({
          target: trade.marketType === "Futures" ? "futures" : "spot",
          path: trade.marketType === "Futures" ? "/fapi/v1/order" : "/api/v3/order",
          method: "POST",
          body,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return {
            closed: null,
            error: `Binance rejected the close order: ${data?.msg || res.statusText}. The position is still open.`,
          };
        }
      } catch (err) {
        return {
          closed: null,
          error: `Network error while closing on Binance: ${err instanceof Error ? err.message : "unknown"}. The position is still open.`,
        };
      }
    }

    return { closed: this.closeTrade(tradeId, exitPrice, exitReason) };
  }

  private async cancelExchangeOrder(symbol: string, orderId: string, marketType: MarketType): Promise<boolean> {
    if (!isLiveTradingConfigured()) return false;
    try {
      const res = await proxyBinanceFetch({
        target: marketType === "Futures" ? "futures" : "spot",
        path: marketType === "Futures" ? "/fapi/v1/order" : "/api/v3/order",
        method: "DELETE",
        query: `symbol=${symbol}&orderId=${orderId}`,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ P/L math

  private marginFor(notionalValue: number, leverage: number, marketType: MarketType): number {
    const lev = marketType === "Futures" ? Math.max(1, leverage) : 1;
    return Number((notionalValue / lev).toFixed(2));
  }

  /**
   * `quantity` is the full position size (notional / entry), already including
   * leverage. Absolute P/L is therefore `priceDiff * quantity`; leverage is applied
   * only when expressing the result as a return on committed margin.
   */
  private calculatePnl(
    entryPrice: number,
    currentPrice: number,
    quantity: number,
    direction: TradeDirection,
    leverage: number,
    marketType: MarketType
  ): { pnl: number; pnlPercent: number } {
    if (
      !Number.isFinite(entryPrice) ||
      !Number.isFinite(currentPrice) ||
      !Number.isFinite(quantity) ||
      entryPrice <= 0 ||
      currentPrice <= 0 ||
      quantity <= 0
    ) {
      return { pnl: 0, pnlPercent: 0 };
    }

    const diff = direction === "LONG" ? currentPrice - entryPrice : entryPrice - currentPrice;
    const pnl = Number((diff * quantity).toFixed(2));
    const lev = marketType === "Futures" ? Math.max(1, leverage) : 1;
    const pnlPercent = Number((((diff / entryPrice) * 100) * lev).toFixed(2));
    return { pnl, pnlPercent };
  }
}

export const tradeManager = new TradeManager();
