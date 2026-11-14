/**
 * auto-trade-worker — 24/7 server-side Auto-Pilot execution.
 *
 * WHY THIS EXISTS
 * ---------------
 * The browser used to run the Auto-Pilot loop, so it stopped the moment the phone
 * locked or the connection dropped. This function owns the loop instead. It is
 * meant to be invoked once per minute by pg_cron (see the
 * `20261112180000_server_auto_pilot.sql` migration for the schedule).
 *
 * PER RUN, PER ENABLED USER
 *   1. Re-check entitlement server-side: Pro, not banned, not expired, global
 *      maintenance/Auto-Pilot flags clear.
 *   2. Respect a 55s cooldown so overlapping cron invocations cannot double-trade.
 *   3. Settle paper positions and reconcile live brackets before opening anything.
 *   4. Decrypt the user's Binance keys from the vault (service role only). Live
 *      mode only: paper trading must never require exchange credentials.
 *   5. Score fresh candles with the server Confluence engine (HTF 1h/4h).
 *   6. Open up to maxOpenTrades positions with ATR-based sizing, a stop-loss /
 *      take-profit bracket, and a `trades` row containing the exchange order ids.
 *
 * AUTH
 *   - pg_cron:   x-cron-secret: <AUTOPILOT_CRON_SECRET>   (compared in constant time)
 *   - operator:  Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *   The browser never calls this function.
 */

import {
  adminClient,
  clampString,
  decryptSecret,
  json,
  preflight,
  timingSafeEqual,
} from "../_shared/security.ts";
import {
  binanceSigned,
  fetchKlines,
  fetchTickerPrice,
  floorTo,
  type Candle,
  type MarketTarget,
} from "../_shared/binance.ts";
import { evaluateServerConfluence } from "../_shared/confluence.ts";

const MAX_USERS_PER_RUN = 25;
const RUN_COOLDOWN_MS = 55_000;
/** Soft deadline for one user, so a slow exchange cannot consume the whole batch. */
const USER_RUN_BUDGET_MS = 15_000;
/** Virtual starting balance for server-side paper trading. */
const PAPER_STARTING_BALANCE = 10_000;
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const DEFAULT_TIMEFRAME = "15m";
const MIN_CONFLUENCE_SCORE = 80;
const ATR_STOP_MULTIPLIER = 1.5;
const ATR_TAKE_PROFIT_MULTIPLIER = 3;
const MAX_EVENTS_KEPT = 200;

type Direction = "LONG" | "SHORT";
type DirectionMode = "BOTH" | "LONG_ONLY" | "SHORT_ONLY";

interface PilotConfig {
  symbols: string[];
  timeframe: string;
  marketType: "Spot" | "Futures";
  leverage: number;
  riskPercent: number;
  maxOpenTrades: number;
  tradeDirectionMode: DirectionMode;
  minScore: number;
  paperTrading: boolean;
}

interface ProfileRow {
  id: string;
  auto_pilot_config: Record<string, unknown> | null;
  is_banned: boolean | null;
  role: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  auto_pilot_armed_at: string | null;
}

interface GlobalFlags {
  maintenanceMode: boolean;
  autoPilotEnabled: boolean;
}

function isProProfile(profile: ProfileRow): boolean {
  if (profile.role === 'admin') return true;
  if (profile.subscription_tier !== 'pro' && profile.subscription_tier !== 'premium') return false;
  if (profile.subscription_status !== 'active' && profile.subscription_status !== 'trialing') return false;
  if (!profile.subscription_expires_at) return true;
  const expires = Date.parse(profile.subscription_expires_at);
  return Number.isFinite(expires) && expires > Date.now();
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeConfig(raw: Record<string, unknown> | null): PilotConfig {
  const config = raw ?? {};
  const symbols = Array.isArray(config.symbols)
    ? config.symbols
        .map((s) => (typeof s === "string" ? s.trim().toUpperCase() : ""))
        .filter((s) => /^[A-Z0-9]{5,20}$/.test(s))
        .slice(0, 10)
    : [];

  const mode = String(config.tradeDirectionMode ?? "BOTH").toUpperCase();
  const marketType = String(config.marketType ?? "Futures").toLowerCase() === "spot" ? "Spot" : "Futures";

  return {
    symbols: symbols.length > 0 ? symbols : DEFAULT_SYMBOLS,
    timeframe: ["15m", "30m", "1h", "4h"].includes(String(config.timeframe))
      ? String(config.timeframe)
      : DEFAULT_TIMEFRAME,
    marketType,
    leverage: asNumber(config.leverage, 5, 1, 10),
    // Hard ceiling of 2% account risk per trade, regardless of what the client sends.
    riskPercent: asNumber(config.riskPercent, 1, 0.25, 2),
    maxOpenTrades: Math.round(asNumber(config.maxOpenTrades, 2, 1, 5)),
    tradeDirectionMode: (["BOTH", "LONG_ONLY", "SHORT_ONLY"].includes(mode) ? mode : "BOTH") as DirectionMode,
    minScore: Math.max(MIN_CONFLUENCE_SCORE, Math.round(asNumber(config.minScore, MIN_CONFLUENCE_SCORE, 0, 100))),
    // Safety default: anything that is not an explicit boolean false runs paper.
    // This prevents a legacy/empty config from silently enabling live trading.
    paperTrading: config.paperTrading === false ? false : true,
  };
}

async function loadGlobalFlags(
  supabase: ReturnType<typeof adminClient>
): Promise<GlobalFlags> {
  const { data } = await supabase
    .from('global_settings')
    .select('maintenance_mode, enable_autopilot')
    .eq('id', 'global_config')
    .maybeSingle();

  return {
    maintenanceMode: data?.maintenance_mode === true,
    // Fail open only if the row/column is unavailable, matching the client.
    autoPilotEnabled: data?.enable_autopilot !== false,
  };
}

function isAuthorized(req: Request): boolean {
  const cronSecret = Deno.env.get("AUTOPILOT_CRON_SECRET") ?? "";
  const headerSecret = req.headers.get("x-cron-secret") ?? "";
  if (cronSecret && headerSecret && timingSafeEqual(cronSecret, headerSecret)) return true;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // pg_cron/pg_net jobs conventionally send the secret on `apikey`.
  const apiKeyHeader = req.headers.get("apikey") ?? "";
  return Boolean(
    serviceKey &&
      ((token && timingSafeEqual(serviceKey, token)) ||
        (apiKeyHeader && timingSafeEqual(serviceKey, apiKeyHeader)))
  );
}

async function logEvent(
  supabase: ReturnType<typeof adminClient>,
  userId: string,
  level: "info" | "success" | "warn" | "error",
  message: string,
  symbol?: string | null,
  details?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("auto_pilot_events").insert({
      user_id: userId,
      level,
      message: clampString(message, 400),
      symbol: symbol ?? null,
      details: details ?? null,
    });
    await supabase.rpc("trim_auto_pilot_events", {
      p_user_id: userId,
      p_keep: MAX_EVENTS_KEPT,
    });
  } catch {
    // Logging must never break execution.
  }
}

async function loadCredentials(
  supabase: ReturnType<typeof adminClient>,
  userId: string
): Promise<{ apiKey: string; apiSecret: string } | null> {
  const { data, error } = await supabase
    .from("user_exchange_credentials")
    .select("key_ciphertext, secret_ciphertext")
    .eq("user_id", userId)
    .eq("exchange", "binance")
    .maybeSingle();

  if (error || !data) return null;
  try {
    return {
      apiKey: await decryptSecret(String(data.key_ciphertext)),
      apiSecret: await decryptSecret(String(data.secret_ciphertext)),
    };
  } catch {
    return null;
  }
}

async function accountBalance(
  apiKey: string,
  apiSecret: string,
  target: MarketTarget
): Promise<number> {
  if (target === "futures") {
    const res = await binanceSigned(apiKey, apiSecret, {
      target,
      method: "GET",
      path: "/fapi/v2/balance",
    });
    if (!res.ok || !Array.isArray(res.data)) return 0;
    const usdt = (res.data as unknown as Array<Record<string, unknown>>).find(
      (row) => String(row.asset).toUpperCase() === "USDT"
    );
    const available = Number(usdt?.availableBalance ?? usdt?.balance ?? 0);
    return Number.isFinite(available) && available > 0 ? available : 0;
  }

  const res = await binanceSigned(apiKey, apiSecret, {
    target,
    method: "GET",
    path: "/api/v3/account",
  });
  if (!res.ok || !res.data || !Array.isArray(res.data.balances)) return 0;
  const usdt = (res.data.balances as Array<Record<string, unknown>>).find(
    (row) => String(row.asset).toUpperCase() === "USDT"
  );
  const free = Number(usdt?.free ?? 0);
  return Number.isFinite(free) && free > 0 ? free : 0;
}

interface ExecutionResult {
  ok: boolean;
  entryPrice?: number;
  quantity?: number;
  stopLoss?: number;
  takeProfit?: number;
  entryOrderId?: string;
  slOrderId?: string;
  tpOrderId?: string;
  fees?: number;
  error?: string;
}

/** Places the entry plus its protective bracket. Credentials are already decrypted. */
async function executeOnBinance(
  apiKey: string,
  apiSecret: string,
  params: {
    symbol: string;
    direction: Direction;
    config: PilotConfig;
    price: number;
    atr: number;
  }
): Promise<ExecutionResult> {
  const { symbol, direction, config, price, atr } = params;
  const target: MarketTarget = config.marketType === "Futures" ? "futures" : "spot";
  const balance = await accountBalance(apiKey, apiSecret, target);
  if (balance <= 0) {
    return { ok: false, error: "No available USDT balance on Binance." };
  }

  const riskAmount = (balance * config.riskPercent) / 100;
  const stopDistance = atr * ATR_STOP_MULTIPLIER;
  if (stopDistance <= 0) return { ok: false, error: "ATR unavailable for position sizing." };

  const stopLoss = direction === "LONG" ? price - stopDistance : price + stopDistance;
  const takeProfit =
    direction === "LONG" ? price + atr * ATR_TAKE_PROFIT_MULTIPLIER : price - atr * ATR_TAKE_PROFIT_MULTIPLIER;

  if (target === "futures") {
    const rawQty = riskAmount / stopDistance;
    const maxNotionalQty = (balance * config.leverage) / price;
    const quantity = floorTo(Math.min(rawQty, maxNotionalQty), 6);
    if (!(quantity > 0)) return { ok: false, error: "Computed quantity is zero." };

    await binanceSigned(apiKey, apiSecret, {
      target,
      method: "POST",
      path: "/fapi/v1/leverage",
      params: { symbol, leverage: config.leverage },
    });

    const entry = await binanceSigned(apiKey, apiSecret, {
      target,
      method: "POST",
      path: "/fapi/v1/order",
      params: {
        symbol,
        side: direction === "LONG" ? "BUY" : "SELL",
        type: "MARKET",
        quantity,
      },
    });
    if (!entry.ok) return { ok: false, error: entry.error || "Futures entry rejected." };

    const closeSide = direction === "LONG" ? "SELL" : "BUY";
    const entryPrice = Number((entry.data?.avgPrice as string) ?? price) || price;
    const entryOrderId = entry.data?.orderId ? String(entry.data.orderId) : undefined;

    // Protective bracket: fail the trade closed if the stop cannot be placed.
    const stop = await binanceSigned(apiKey, apiSecret, {
      target,
      method: "POST",
      path: "/fapi/v1/order",
      params: {
        symbol,
        side: closeSide,
        type: "STOP_MARKET",
        stopPrice: floorTo(stopLoss, 2),
        closePosition: "true",
        workingType: "MARK_PRICE",
      },
    });
    if (!stop.ok) {
      await binanceSigned(apiKey, apiSecret, {
        target,
        method: "POST",
        path: "/fapi/v1/order",
        params: {
          symbol,
          side: closeSide,
          type: "MARKET",
          quantity,
          reduceOnly: "true",
        },
      });
      return { ok: false, error: `Stop-loss rejected, position closed: ${stop.error}` };
    }

    const takeProfitOrder = await binanceSigned(apiKey, apiSecret, {
      target,
      method: "POST",
      path: "/fapi/v1/order",
      params: {
        symbol,
        side: closeSide,
        type: "TAKE_PROFIT_MARKET",
        stopPrice: floorTo(takeProfit, 2),
        closePosition: "true",
        workingType: "MARK_PRICE",
      },
    });

    if (!takeProfitOrder.ok) {
      // The stop is already live, so the position is protected. Surface the
      // failure in the event log instead of pretending the bracket is complete.
      console.warn(
        `[auto-trade-worker] take-profit rejected for ${symbol}: ${takeProfitOrder.error ?? "unknown"}`
      );
    }

    return {
      ok: true,
      entryPrice,
      quantity,
      stopLoss: floorTo(stopLoss, 2),
      takeProfit: floorTo(takeProfit, 2),
      entryOrderId,
      slOrderId: stop.data?.orderId ? String(stop.data.orderId) : undefined,
      tpOrderId: takeProfitOrder.data?.orderId
        ? String(takeProfitOrder.data.orderId)
        : undefined,
      fees: 0,
    };
  }

  // Spot: spend quote currency, then protect with an OCO (best effort — a failed
  // OCO is reported in the event log but does not hide a filled entry).
  const quoteAmount = floorTo(Math.min(riskAmount, balance * 0.95), 2);
  if (!(quoteAmount > 0)) return { ok: false, error: "Computed order amount is zero." };

  const entry = await binanceSigned(apiKey, apiSecret, {
    target,
    method: "POST",
    path: "/api/v3/order",
    params: { symbol, side: "BUY", type: "MARKET", quoteOrderQty: quoteAmount },
  });
  if (!entry.ok) return { ok: false, error: entry.error || "Spot entry rejected." };

  const executedQty = Number((entry.data?.executedQty as string) ?? 0);
  const entryPrice = Number((entry.data?.fills as Array<{ price?: string }>)?.[0]?.price ?? price) || price;
  const quantity = floorTo(executedQty, 6);
  if (!(quantity > 0)) return { ok: false, error: "Spot order filled with zero quantity." };

  const oco = await binanceSigned(apiKey, apiSecret, {
    target,
    method: "POST",
    path: "/api/v3/orderList/oco",
    params: {
      symbol,
      side: "SELL",
      quantity,
      price: floorTo(takeProfit, 2),
      stopPrice: floorTo(stopLoss, 2),
      stopLimitPrice: floorTo(stopLoss * 0.999, 2),
      stopLimitTimeInForce: "GTC",
    },
  });

  if (!oco.ok) {
    // A spot position without a stop is worse than no position. Close it now.
    const unwind = await binanceSigned(apiKey, apiSecret, {
      target,
      method: "POST",
      path: "/api/v3/order",
      params: { symbol, side: "SELL", type: "MARKET", quantity },
    });
    return {
      ok: false,
      error: `Protective OCO was rejected${unwind.ok ? "; the spot position was closed" : "; manual intervention required to close the spot position"}: ${oco.error ?? "unknown error"}`,
    };
  }

  return {
    ok: true,
    entryPrice,
    quantity,
    stopLoss: floorTo(stopLoss, 2),
    takeProfit: floorTo(takeProfit, 2),
    entryOrderId: entry.data?.orderId ? String(entry.data.orderId) : undefined,
    tpOrderId: oco.data?.orderListId !== undefined ? String(oco.data.orderListId) : undefined,
    fees: 0,
  };
}

interface OpenTradeRow {
  id: string;
  symbol: string;
  direction: Direction;
  entry_price: number | string;
  quantity: number | string;
  leverage: number | string | null;
  market_type: string | null;
  stop_loss_price: number | string | null;
  take_profit_price: number | string | null;
  sl_order_id: string | null;
  tp_order_id: string | null;
}

function signedPnl(
  direction: Direction,
  entryPrice: number,
  exitPrice: number,
  quantity: number
): number {
  return (exitPrice - entryPrice) * quantity * (direction === "LONG" ? 1 : -1);
}

/** Virtual paper equity: starting balance plus every realised paper P&L. */
async function paperAccountBalance(
  supabase: ReturnType<typeof adminClient>,
  userId: string
): Promise<number> {
  const { data } = await supabase
    .from("trades")
    .select("pnl")
    .eq("user_id", userId)
    .eq("is_paper", true)
    .eq("status", "CLOSED")
    .limit(1000);

  const realised = (data ?? []).reduce((sum, row) => sum + Number(row.pnl ?? 0), 0);
  return PAPER_STARTING_BALANCE + realised;
}

/** Settles paper positions whose SL/TP has been touched since the last run. */
async function settlePaperPositions(
  supabase: ReturnType<typeof adminClient>,
  userId: string
): Promise<number> {
  const { data } = await supabase
    .from("trades")
    .select("id, symbol, direction, entry_price, quantity, leverage, market_type, stop_loss_price, take_profit_price, sl_order_id, tp_order_id")
    .eq("user_id", userId)
    .eq("is_paper", true)
    .eq("status", "OPEN")
    .limit(50);

  const rows = (data ?? []) as OpenTradeRow[];
  if (rows.length === 0) return 0;

  const prices = new Map<string, number | null>();
  let closed = 0;

  for (const row of rows) {
    const quantity = Number(row.quantity);
    const entryPrice = Number(row.entry_price);
    // Legacy broken rows have quantity 0 and cannot be settled meaningfully.
    if (!(quantity > 0) || !(entryPrice > 0)) continue;

    if (!prices.has(row.symbol)) {
      prices.set(row.symbol, await fetchTickerPrice(row.symbol));
    }
    const price = prices.get(row.symbol);
    if (price === null || price === undefined) continue;

    const stop = Number(row.stop_loss_price ?? 0);
    const target = Number(row.take_profit_price ?? 0);
    const isLong = row.direction === "LONG";

    let exitReason: "SL" | "TP" | null = null;
    if (stop > 0 && (isLong ? price <= stop : price >= stop)) exitReason = "SL";
    else if (target > 0 && (isLong ? price >= target : price <= target)) exitReason = "TP";
    if (!exitReason) continue;

    const exitPrice = exitReason === "SL" ? stop : target;
    const pnl = signedPnl(row.direction, entryPrice, exitPrice, quantity);
    const leverage = Math.max(1, Number(row.leverage ?? 1));
    const margin = (entryPrice * quantity) / leverage;
    const pnlPercent = margin > 0 ? (pnl / margin) * 100 : 0;

    const { error } = await supabase
      .from("trades")
      .update({
        status: "CLOSED",
        exit_price: exitPrice,
        exit_reason: exitReason,
        pnl,
        pnl_percent: pnlPercent,
        closed_at: new Date().toISOString(),
        closed_by: "AUTO_PILOT",
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", userId)
      .eq("status", "OPEN");

    if (!error) closed += 1;
  }

  return closed;
}

async function closeLivePosition(
  apiKey: string,
  apiSecret: string,
  params: { symbol: string; direction: Direction; quantity: number; marketType: "Spot" | "Futures" }
): Promise<boolean> {
  const target: MarketTarget = params.marketType === "Futures" ? "futures" : "spot";
  const quantity = floorTo(params.quantity, 6);
  if (!(quantity > 0)) return false;

  const res = await binanceSigned(apiKey, apiSecret, {
    target,
    method: "POST",
    path: target === "futures" ? "/fapi/v1/order" : "/api/v3/order",
    params: {
      symbol: params.symbol,
      side: params.direction === "LONG" ? "SELL" : "BUY",
      type: "MARKET",
      quantity,
      ...(target === "futures" ? { reduceOnly: "true" } : {}),
    },
  });

  return res.ok;
}

async function markTradeClosed(
  supabase: ReturnType<typeof adminClient>,
  userId: string,
  row: OpenTradeRow,
  exitPrice: number,
  exitReason: "SL" | "TP" | "MANUAL",
  fees = 0
): Promise<void> {
  const entryPrice = Number(row.entry_price);
  const quantity = Number(row.quantity);
  const leverage = Math.max(1, Number(row.leverage ?? 1));
  const pnl = signedPnl(row.direction, entryPrice, exitPrice, quantity) - fees;
  const margin = (entryPrice * quantity) / leverage;
  const pnlPercent = margin > 0 ? (pnl / margin) * 100 : 0;

  await supabase
    .from("trades")
    .update({
      status: "CLOSED",
      exit_price: exitPrice,
      exit_reason: exitReason,
      pnl,
      pnl_percent: pnlPercent,
      fees,
      closed_at: new Date().toISOString(),
      closed_by: "EXCHANGE_BRACKET",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("user_id", userId)
    .eq("status", "OPEN");
}

/**
 * Detects fills of the stop/take-profit orders the worker placed. Without this,
 * a position closed by Binance while the app was offline stayed OPEN forever.
 */
async function reconcileLivePositions(
  supabase: ReturnType<typeof adminClient>,
  userId: string,
  apiKey: string,
  apiSecret: string
): Promise<number> {
  const { data } = await supabase
    .from("trades")
    .select("id, symbol, direction, entry_price, quantity, leverage, market_type, stop_loss_price, take_profit_price, sl_order_id, tp_order_id")
    .eq("user_id", userId)
    .eq("is_paper", false)
    .eq("status", "OPEN")
    .limit(20);

  const rows = (data ?? []) as OpenTradeRow[];
  let reconciled = 0;

  for (const row of rows) {
    const futures = row.market_type === "Futures";

    if (futures) {
      // Futures brackets are two separate orders with their own order ids.
      for (const [reason, orderId] of [
        ["SL", row.sl_order_id],
        ["TP", row.tp_order_id],
      ] as Array<["SL" | "TP", string | null]>) {
        if (!orderId) continue;
        try {
          const res = await binanceSigned(apiKey, apiSecret, {
            target: "futures",
            method: "GET",
            path: "/fapi/v1/order",
            params: { symbol: row.symbol, orderId },
          });
          if (!res.ok || !res.data) continue;
          if (String(res.data.status).toUpperCase() !== "FILLED") continue;

          const fillPrice = Number(
            res.data.avgPrice ?? res.data.price ??
              (reason === "SL" ? row.stop_loss_price : row.take_profit_price)
          );
          if (!(fillPrice > 0)) continue;

          await markTradeClosed(supabase, userId, row, fillPrice, reason);
          reconciled += 1;
          break;
        } catch {
          // A single order lookup must not stop the reconciliation pass.
        }
      }
      continue;
    }

    // Spot OCO is stored as an order-list id in tp_order_id, not an order id.
    if (!row.tp_order_id) continue;
    try {
      const res = await binanceSigned(apiKey, apiSecret, {
        target: "spot",
        method: "GET",
        path: "/api/v3/orderList",
        params: { orderListId: row.tp_order_id },
      });
      const orders = Array.isArray(res.data?.orders) ? res.data.orders : [];
      const filled = orders.find(
        (order: Record<string, unknown>) => String(order.status).toUpperCase() === "FILLED"
      ) as Record<string, unknown> | undefined;
      if (filled) {
        const fillPrice = Number(filled.price ?? row.take_profit_price ?? 0);
        if (fillPrice > 0) {
          await markTradeClosed(supabase, userId, row, fillPrice, "TP");
          reconciled += 1;
        }
      }
    } catch {
      // best effort
    }
  }

  return reconciled;
}

interface RunOutcome {
  user_id: string;
  status: "skipped" | "executed" | "error" | "no_signal";
  reason?: string;
  symbol?: string;
  score?: number;
  /** How many positions this run opened (multi-symbol fill up to maxOpenTrades). */
  executed?: number;
}

async function runForUser(
  supabase: ReturnType<typeof adminClient>,
  profile: ProfileRow,
  flags: GlobalFlags,
  deadline: number
): Promise<RunOutcome> {
  const userId = profile.id;
  const config = normalizeConfig(profile.auto_pilot_config);
  const now = Date.now();

  // Entitlement gates are re-checked here, not just at toggle time: a
  // subscription can expire or an account can be banned while Auto-Pilot is on.
  if (profile.is_banned) {
    await supabase
      .from("user_profiles")
      .update({ auto_pilot_enabled: false, updated_at: new Date().toISOString() })
      .eq("id", userId);
    await logEvent(supabase, userId, "warn", "Auto-Pilot disabled: this account is suspended.");
    return { user_id: userId, status: "skipped", reason: "Account suspended" };
  }

  if (!isProProfile(profile)) {
    await supabase
      .from("user_profiles")
      .update({ auto_pilot_enabled: false, updated_at: new Date().toISOString() })
      .eq("id", userId);
    await logEvent(
      supabase,
      userId,
      "warn",
      "Auto-Pilot disabled: an active Pro subscription is required."
    );
    return { user_id: userId, status: "skipped", reason: "Subscription inactive" };
  }

  if (profile.role !== "admin" && (flags.maintenanceMode || !flags.autoPilotEnabled)) {
    // Do not flip the user's flag: the platform may re-enable Auto-Pilot.
    return { user_id: userId, status: "skipped", reason: "Platform Auto-Pilot disabled" };
  }

  if (Date.now() >= deadline) {
    return { user_id: userId, status: "skipped", reason: "Batch deadline reached" };
  }

  const { data: run } = await supabase
    .from("auto_pilot_runs")
    .select("last_run_at, last_candle_ms, last_score, last_candle_by_symbol")
    .eq("user_id", userId)
    .maybeSingle();

  if (run?.last_run_at && now - Date.parse(String(run.last_run_at)) < RUN_COOLDOWN_MS) {
    return { user_id: userId, status: "skipped", reason: "Cooldown" };
  }

  // Fairness: the next batch orders by this column, so users beyond
  // MAX_USERS_PER_RUN rotate instead of being starved forever.
  await supabase
    .from("user_profiles")
    .update({ last_worker_run_at: new Date(now).toISOString() })
    .eq("id", userId);

  const saveRun = async (patch: Record<string, unknown>) => {
    await supabase.from("auto_pilot_runs").upsert(
      { user_id: userId, last_run_at: new Date(now).toISOString(), updated_at: new Date().toISOString(), ...patch },
      { onConflict: "user_id" }
    );
  };

  // Per-symbol candle cursors. A single shared cursor meant one entry on BTC hid
  // every other symbol until the next candle, so maxOpenTrades > 1 never filled.
  const candleCursors: Record<string, number> = {};
  const storedCursors = run?.last_candle_by_symbol;
  if (storedCursors && typeof storedCursors === "object") {
    for (const [key, value] of Object.entries(storedCursors as Record<string, unknown>)) {
      const ts = Number(value);
      if (Number.isFinite(ts) && ts > 0) candleCursors[key] = ts;
    }
  }

  // Settle/reconcile before counting open positions, so a bracket that filled
  // since the last run frees its slot in this same run.
  let credentials: { apiKey: string; apiSecret: string } | null = null;
  if (config.paperTrading) {
    const settled = await settlePaperPositions(supabase, userId);
    if (settled > 0) {
      await logEvent(supabase, userId, "info", `Settled ${settled} paper position(s) at SL/TP.`);
    }
  } else {
    credentials = await loadCredentials(supabase, userId);
    if (!credentials) {
      await logEvent(supabase, userId, "warn", "Auto-Pilot is armed in live mode but no Binance API keys are stored.");
      await saveRun({ last_error: "Missing Binance credentials" });
      return { user_id: userId, status: "skipped", reason: "Missing credentials" };
    }

    const reconciled = await reconcileLivePositions(
      supabase,
      userId,
      credentials.apiKey,
      credentials.apiSecret
    );
    if (reconciled > 0) {
      await logEvent(supabase, userId, "info", `Reconciled ${reconciled} closed exchange position(s).`);
    }
  }

  const { data: openRows } = await supabase
    .from("trades")
    .select("id, symbol")
    .eq("user_id", userId)
    .eq("status", "OPEN")
    // Paper runs must count their own paper positions against maxOpenTrades.
    .eq("is_paper", config.paperTrading)
    .limit(50);

  const openTrades = (openRows ?? []) as Array<{ id: string; symbol: string }>;
  if (openTrades.length >= config.maxOpenTrades) {
    await saveRun({ last_error: null });
    return { user_id: userId, status: "skipped", reason: "Max open trades reached" };
  }

  const paperBalance = config.paperTrading ? await paperAccountBalance(supabase, userId) : 0;

  interface Candidate {
    symbol: string;
    score: number;
    direction: Direction;
    price: number;
    atr: number;
    candle: Candle;
  }

  const candidates: Candidate[] = [];
  const openSymbols = new Set(openTrades.map((t) => t.symbol));
  const cursorFallback = Number(run?.last_candle_ms ?? 0) || 0;

  for (const symbol of config.symbols) {
    if (Date.now() >= deadline) break;
    if (openSymbols.has(symbol)) continue;
    try {
      const entryCandles = await fetchKlines(symbol, config.timeframe, 300);
      const htf1h = await fetchKlines(symbol, "1h", 200);
      const htf4h = await fetchKlines(symbol, "4h", 120);
      if (entryCandles.length < 60) continue;

      // Only ever evaluate closed candles: the last row is still forming.
      const closed = entryCandles.slice(0, -1);
      const lastClosed = closed.at(-1)!;
      // Per-symbol cursor: an entry on one symbol must not hide a fresh signal on
      // another symbol during the same candle.
      const lastSeen = candleCursors[symbol] ?? cursorFallback;
      if (lastSeen && lastClosed.time <= lastSeen) continue;

      const signal = evaluateServerConfluence(closed, htf1h.slice(0, -1), htf4h.slice(0, -1), {
        minScore: config.minScore,
      });
      if (!signal.canExecute) continue;

      const direction: Direction = signal.bias === "Strong Buy" ? "LONG" : "SHORT";
      if (config.marketType === "Spot" && direction === "SHORT") continue;
      if (config.tradeDirectionMode === "LONG_ONLY" && direction === "SHORT") continue;
      if (config.tradeDirectionMode === "SHORT_ONLY" && direction === "LONG") continue;

      candidates.push({
        symbol,
        score: signal.score,
        direction,
        price: signal.price,
        atr: signal.atr,
        candle: lastClosed,
      });
    } catch (err) {
      await logEvent(
        supabase,
        userId,
        "warn",
        `Symbol scan failed: ${err instanceof Error ? err.message : "unknown error"}`,
        symbol
      );
    }
  }

  if (candidates.length === 0) {
    await saveRun({ last_error: null });
    return { user_id: userId, status: "no_signal" };
  }

  // Strongest setups first, then keep opening until maxOpenTrades is reached or
  // the candidate list is exhausted — one valid symbol no longer ends the run.
  candidates.sort((a, b) => b.score - a.score);

  const slots = Math.max(0, config.maxOpenTrades - openTrades.length);
  const executed: Array<{ symbol: string; score: number }> = [];
  let lastError: string | null = null;

  for (const candidate of candidates) {
    if (executed.length >= slots) break;
    if (Date.now() >= deadline) {
      lastError = lastError ?? "Batch deadline reached before every candidate was executed.";
      break;
    }

    // Guard against a stale signal: re-price before sizing the order.
    const livePrice = await fetchTickerPrice(candidate.symbol);
    if (livePrice === null || Math.abs(livePrice - candidate.price) / candidate.price > 0.01) {
      await logEvent(
        supabase,
        userId,
        "warn",
        "Signal skipped: price moved more than 1% before execution.",
        candidate.symbol,
        { signalPrice: candidate.price, livePrice }
      );
      candleCursors[candidate.symbol] = candidate.candle.time;
      continue;
    }

    const leverage = config.marketType === "Futures" ? config.leverage : 1;
    const stopDistance = candidate.atr * ATR_STOP_MULTIPLIER;
    if (!(stopDistance > 0)) {
      lastError = "ATR unavailable for position sizing.";
      continue;
    }

    const stopLoss =
      candidate.direction === "LONG" ? livePrice - stopDistance : livePrice + stopDistance;
    const takeProfit =
      candidate.direction === "LONG"
        ? livePrice + candidate.atr * ATR_TAKE_PROFIT_MULTIPLIER
        : livePrice - candidate.atr * ATR_TAKE_PROFIT_MULTIPLIER;
    const tradeId = `SRV-${crypto.randomUUID()}`;
    const clientOrderId = `${config.paperTrading ? "paper" : "live"}-${crypto.randomUUID()}`;

    if (config.paperTrading) {
      const riskAmount = (paperBalance * config.riskPercent) / 100;
      const maxNotional = paperBalance * leverage * 0.95;
      const quantity = floorTo(
        Math.min(riskAmount / stopDistance, maxNotional / livePrice),
        6
      );

      if (!(quantity > 0)) {
        lastError = "Computed paper quantity is zero.";
        continue;
      }

      const { error } = await supabase.from("trades").insert({
        id: tradeId,
        user_id: userId,
        symbol: candidate.symbol,
        direction: candidate.direction,
        entry_price: livePrice,
        quantity,
        leverage,
        market_type: config.marketType,
        stop_loss_price: floorTo(stopLoss, 2),
        take_profit_price: floorTo(takeProfit, 2),
        source: "AUTO-PILOT",
        is_paper: true,
        status: "OPEN",
        client_order_id: clientOrderId,
        fees: 0,
      });
      if (error) {
        lastError = `Paper insert failed: ${error.message}`;
        continue;
      }
      executed.push({ symbol: candidate.symbol, score: candidate.score });
      candleCursors[candidate.symbol] = candidate.candle.time;
      await logEvent(
        supabase,
        userId,
        "success",
        `Paper Auto-Pilot entry ${candidate.direction} ${candidate.symbol} qty ${quantity} (score ${candidate.score}).`,
        candidate.symbol,
        { score: candidate.score, price: livePrice, quantity, stopLoss, takeProfit }
      );
      continue;
    }

    if (!credentials) {
      lastError = "Missing Binance credentials.";
      break;
    }

    const result = await executeOnBinance(credentials.apiKey, credentials.apiSecret, {
      symbol: candidate.symbol,
      direction: candidate.direction,
      config,
      price: livePrice,
      atr: candidate.atr,
    });

    if (!result.ok) {
      lastError = result.error ?? "Trade rejected";
      await logEvent(
        supabase,
        userId,
        "error",
        `Trade rejected: ${result.error ?? "unknown error"}`,
        candidate.symbol,
        { score: candidate.score }
      );
      // A rejection is symbol-specific; keep evaluating the remaining candidates.
      continue;
    }

    const { error: insertError } = await supabase.from("trades").insert({
      id: tradeId,
      user_id: userId,
      symbol: candidate.symbol,
      direction: candidate.direction,
      entry_price: result.entryPrice ?? livePrice,
      quantity: result.quantity ?? 0,
      leverage,
      market_type: config.marketType,
      stop_loss_price: result.stopLoss ?? null,
      take_profit_price: result.takeProfit ?? null,
      entry_order_id: result.entryOrderId ?? null,
      sl_order_id: result.slOrderId ?? null,
      tp_order_id: result.tpOrderId ?? null,
      client_order_id: clientOrderId,
      fees: result.fees ?? 0,
      source: "AUTO-PILOT",
      is_paper: false,
      status: "OPEN",
    });

    if (insertError) {
      // The exchange position exists but the UI has no record of it. Close it
      // immediately rather than leaving an unmanaged live position.
      const closed = await closeLivePosition(credentials.apiKey, credentials.apiSecret, {
        symbol: candidate.symbol,
        direction: candidate.direction,
        quantity: result.quantity ?? 0,
        marketType: config.marketType,
      });
      lastError = `Entry filled but the trade record failed: ${insertError.message}`;
      await logEvent(
        supabase,
        userId,
        "error",
        closed
          ? `Trade record failed; the live position was closed automatically (${insertError.message}).`
          : `Trade record failed AND the live position could not be closed. Manual action required (${insertError.message}).`,
        candidate.symbol,
        { score: candidate.score, quantity: result.quantity }
      );
      continue;
    }

    executed.push({ symbol: candidate.symbol, score: candidate.score });
    candleCursors[candidate.symbol] = candidate.candle.time;

    await logEvent(
      supabase,
      userId,
      "success",
      `Executed ${candidate.direction} ${candidate.symbol} at ${result.entryPrice?.toFixed(2)} (confluence ${candidate.score}/100).`,
      candidate.symbol,
      {
        score: candidate.score,
        quantity: result.quantity,
        stopLoss: result.stopLoss,
        takeProfit: result.takeProfit,
      }
    );
  }

  await saveRun({
    last_candle_ms: candidates[0].candle.time,
    last_score: candidates[0].score,
    last_symbol: executed[0]?.symbol ?? candidates[0].symbol,
    last_candle_by_symbol: candleCursors,
    last_error: executed.length > 0 ? null : lastError,
  });

  if (executed.length === 0) {
    return {
      user_id: userId,
      status: "skipped",
      reason: lastError ?? "No executable candidates",
      symbol: candidates[0].symbol,
    };
  }

  return {
    user_id: userId,
    status: "executed",
    symbol: executed[0].symbol,
    score: executed[0].score,
    executed: executed.length,
  };
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!isAuthorized(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    let requestedUser: string | null = null;
    if (req.headers.get("content-length") && req.headers.get("content-length") !== "0") {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        requestedUser = typeof body.user_id === "string" ? body.user_id : null;
      } catch {
        requestedUser = null;
      }
    }

    const supabase = adminClient();
    const flags = await loadGlobalFlags(supabase);
    let query = supabase
      .from("user_profiles")
      .select("id, auto_pilot_config, is_banned, role, subscription_tier, subscription_status, subscription_expires_at, auto_pilot_armed_at")
      .eq("auto_pilot_enabled", true)
      // Least-recently-run first, so users beyond the batch limit still run.
      .order("last_worker_run_at", { ascending: true, nullsFirst: true })
      .limit(MAX_USERS_PER_RUN);

    if (requestedUser) query = query.eq("id", requestedUser);

    const { data, error } = await query;
    if (error) {
      console.error("[auto-trade-worker] profile query failed:", error.message);
      return json({ error: "Failed to load Auto-Pilot users" }, 500);
    }

    const profiles = (data ?? []) as ProfileRow[];
    const results: RunOutcome[] = [];
    const batchDeadline = Date.now() + 90_000;

    for (const profile of profiles) {
      try {
        const userDeadline = Math.min(batchDeadline, Date.now() + USER_RUN_BUDGET_MS);
        results.push(await runForUser(supabase, profile, flags, userDeadline));
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown error";
        console.error(`[auto-trade-worker] user ${profile.id} failed:`, message);
        await logEvent(supabase, profile.id, "error", `Auto-Pilot run failed: ${message}`);
        results.push({ user_id: profile.id, status: "error", reason: message });
      }
    }

    const executed = results.filter((r) => r.status === "executed").length;
    return json({ ok: true, users: profiles.length, executed, results });
  } catch (err) {
    console.error("[auto-trade-worker] internal error:", err instanceof Error ? err.message : err);
    return json({ error: "Auto-Pilot worker internal error" }, 500);
  }
});
