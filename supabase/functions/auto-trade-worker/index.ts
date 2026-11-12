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
 *   1. Respect a 55s cooldown so overlapping cron invocations cannot double-trade.
 *   2. Decrypt the user's Binance keys from the vault (service role only).
 *   3. Score fresh 15m candles with the server Confluence engine (HTF 1h/4h).
 *   4. Execute at most one trade when the score is >= 85, with ATR-based sizing,
 *      a stop-loss / take-profit bracket, and a `trades` row for the UI.
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
const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const DEFAULT_TIMEFRAME = "15m";
const MIN_CONFLUENCE_SCORE = 85;
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
    paperTrading: config.paperTrading === true,
  };
}

function isAuthorized(req: Request): boolean {
  const cronSecret = Deno.env.get("AUTOPILOT_CRON_SECRET") ?? "";
  const headerSecret = req.headers.get("x-cron-secret") ?? "";
  if (cronSecret && headerSecret && timingSafeEqual(cronSecret, headerSecret)) return true;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(serviceKey && token && timingSafeEqual(serviceKey, token));
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
    await supabase.rpc("trim_auto_pilot_events", { p_keep: MAX_EVENTS_KEPT });
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
  tradeId?: string;
  entryPrice?: number;
  quantity?: number;
  stopLoss?: number;
  takeProfit?: number;
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

    await binanceSigned(apiKey, apiSecret, {
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

    return {
      ok: true,
      entryPrice,
      quantity,
      stopLoss: floorTo(stopLoss, 2),
      takeProfit: floorTo(takeProfit, 2),
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

  await binanceSigned(apiKey, apiSecret, {
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

  return {
    ok: true,
    entryPrice,
    quantity,
    stopLoss: floorTo(stopLoss, 2),
    takeProfit: floorTo(takeProfit, 2),
  };
}

interface RunOutcome {
  user_id: string;
  status: "skipped" | "executed" | "error" | "no_signal";
  reason?: string;
  symbol?: string;
  score?: number;
}

async function runForUser(
  supabase: ReturnType<typeof adminClient>,
  profile: ProfileRow
): Promise<RunOutcome> {
  const userId = profile.id;
  const config = normalizeConfig(profile.auto_pilot_config);
  const now = Date.now();

  const { data: run } = await supabase
    .from("auto_pilot_runs")
    .select("last_run_at, last_candle_ms, last_score")
    .eq("user_id", userId)
    .maybeSingle();

  if (run?.last_run_at && now - Date.parse(String(run.last_run_at)) < RUN_COOLDOWN_MS) {
    return { user_id: userId, status: "skipped", reason: "Cooldown" };
  }

  const saveRun = async (patch: Record<string, unknown>) => {
    await supabase.from("auto_pilot_runs").upsert(
      { user_id: userId, last_run_at: new Date(now).toISOString(), updated_at: new Date().toISOString(), ...patch },
      { onConflict: "user_id" }
    );
  };

  const credentials = await loadCredentials(supabase, userId);
  if (!credentials) {
    await logEvent(supabase, userId, "warn", "Auto-Pilot is armed but no Binance API keys are stored.");
    await saveRun({ last_error: "Missing Binance credentials" });
    return { user_id: userId, status: "skipped", reason: "Missing credentials" };
  }

  const { data: openRows } = await supabase
    .from("trades")
    .select("id, symbol")
    .eq("user_id", userId)
    .eq("status", "OPEN")
    .eq("is_paper", false)
    .limit(50);

  const openTrades = (openRows ?? []) as Array<{ id: string; symbol: string }>;
  if (openTrades.length >= config.maxOpenTrades) {
    await saveRun({ last_error: null });
    return { user_id: userId, status: "skipped", reason: "Max open trades reached" };
  }

  let best: { symbol: string; score: number; direction: Direction; price: number; atr: number; candle: Candle } | null =
    null;

  for (const symbol of config.symbols) {
    if (openTrades.some((t) => t.symbol === symbol)) continue;
    try {
      const entryCandles = await fetchKlines(symbol, config.timeframe, 300);
      const htf1h = await fetchKlines(symbol, "1h", 200);
      const htf4h = await fetchKlines(symbol, "4h", 120);
      if (entryCandles.length < 60) continue;

      // Only ever evaluate closed candles: the last row is still forming.
      const closed = entryCandles.slice(0, -1);
      const lastClosed = closed.at(-1)!;
      if (run?.last_candle_ms && lastClosed.time <= Number(run.last_candle_ms)) continue;

      const signal = evaluateServerConfluence(closed, htf1h.slice(0, -1), htf4h.slice(0, -1), {
        minScore: config.minScore,
      });
      if (!signal.canExecute) continue;

      const direction: Direction = signal.bias === "Strong Buy" ? "LONG" : "SHORT";
      if (config.marketType === "Spot" && direction === "SHORT") continue;
      if (config.tradeDirectionMode === "LONG_ONLY" && direction === "SHORT") continue;
      if (config.tradeDirectionMode === "SHORT_ONLY" && direction === "LONG") continue;

      if (!best || signal.score > best.score) {
        best = { symbol, score: signal.score, direction, price: signal.price, atr: signal.atr, candle: lastClosed };
      }
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

  if (!best) {
    await saveRun({ last_error: null });
    return { user_id: userId, status: "no_signal" };
  }

  // Guard against a stale signal: re-price before sizing the order.
  const livePrice = await fetchTickerPrice(best.symbol);
  if (livePrice === null || Math.abs(livePrice - best.price) / best.price > 0.01) {
    await logEvent(supabase, userId, "warn", "Signal skipped: price moved more than 1% before execution.", best.symbol, {
      signalPrice: best.price,
      livePrice,
    });
    await saveRun({ last_candle_ms: best.candle.time, last_score: best.score });
    return { user_id: userId, status: "skipped", reason: "Slippage guard", symbol: best.symbol };
  }

  const tradeId = `SRV-${now}-${Math.floor(Math.random() * 1000)}`;

  if (config.paperTrading) {
    await supabase.from("trades").insert({
      id: tradeId,
      user_id: userId,
      symbol: best.symbol,
      direction: best.direction,
      entry_price: livePrice,
      quantity: 0,
      leverage: config.marketType === "Futures" ? config.leverage : 1,
      market_type: config.marketType,
      source: "AUTO-PILOT",
      is_paper: true,
      status: "OPEN",
    });
    await logEvent(supabase, userId, "success", `Paper Auto-Pilot entry ${best.direction} (score ${best.score}).`, best.symbol, {
      score: best.score,
      price: livePrice,
    });
    await saveRun({ last_candle_ms: best.candle.time, last_score: best.score, last_symbol: best.symbol });
    return { user_id: userId, status: "executed", symbol: best.symbol, score: best.score };
  }

  const result = await executeOnBinance(credentials.apiKey, credentials.apiSecret, {
    symbol: best.symbol,
    direction: best.direction,
    config,
    price: livePrice,
    atr: best.atr,
  });

  if (!result.ok) {
    await logEvent(supabase, userId, "error", `Trade rejected: ${result.error ?? "unknown error"}`, best.symbol, {
      score: best.score,
    });
    await saveRun({ last_error: result.error ?? "Trade rejected", last_candle_ms: best.candle.time });
    return { user_id: userId, status: "error", reason: result.error, symbol: best.symbol };
  }

  await supabase.from("trades").insert({
    id: tradeId,
    user_id: userId,
    symbol: best.symbol,
    direction: best.direction,
    entry_price: result.entryPrice ?? livePrice,
    quantity: result.quantity ?? 0,
    leverage: config.marketType === "Futures" ? config.leverage : 1,
    market_type: config.marketType,
    stop_loss_price: result.stopLoss ?? null,
    take_profit_price: result.takeProfit ?? null,
    source: "AUTO-PILOT",
    is_paper: false,
    status: "OPEN",
  });

  await logEvent(
    supabase,
    userId,
    "success",
    `Executed ${best.direction} ${best.symbol} at ${result.entryPrice?.toFixed(2)} (confluence ${best.score}/100).`,
    best.symbol,
    { score: best.score, quantity: result.quantity, stopLoss: result.stopLoss, takeProfit: result.takeProfit }
  );
  await saveRun({
    last_candle_ms: best.candle.time,
    last_score: best.score,
    last_symbol: best.symbol,
    last_error: null,
  });

  return { user_id: userId, status: "executed", symbol: best.symbol, score: best.score };
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
    let query = supabase
      .from("user_profiles")
      .select("id, auto_pilot_config")
      .eq("auto_pilot_enabled", true)
      .limit(MAX_USERS_PER_RUN);

    if (requestedUser) query = query.eq("id", requestedUser);

    const { data, error } = await query;
    if (error) {
      console.error("[auto-trade-worker] profile query failed:", error.message);
      return json({ error: "Failed to load Auto-Pilot users" }, 500);
    }

    const profiles = (data ?? []) as ProfileRow[];
    const results: RunOutcome[] = [];

    for (const profile of profiles) {
      try {
        results.push(await runForUser(supabase, profile));
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
