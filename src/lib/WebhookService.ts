/**
 * WebhookService.ts
 *
 * Manages the TradingView webhook endpoint, the user's server-issued secret token,
 * and local signal dispatch for the UI.
 *
 * SECURITY: tokens are generated and stored by Postgres (`get_or_create_webhook_token`
 * / `rotate_webhook_token`) and verified server-side by hash. The token is kept in
 * memory only — never written to localStorage — and the edge function rejects any
 * token it did not issue.
 */

import { supabase } from "./supabase";

export interface TradingViewSignal {
  id: string;
  timestamp: number;
  direction: "BUY" | "SELL";
  symbol: string;
  price?: number;
  source: string;
  rawPayload?: string;
}

const STORAGE_KEY_WEBHOOK_LOGS = "fortress_tradingview_webhook_logs";

type SignalListener = (signal: TradingViewSignal) => void;

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

class WebhookService {
  private userToken: string = "";
  private signingSecret: string = "";
  private tokenLoaded = false;
  private listeners: Set<SignalListener> = new Set();
  private signalLogs: TradingViewSignal[] = [];

  constructor() {
    this.init();
  }

  private init(): void {
    if (typeof localStorage === "undefined") return;

    try {
      const logsRaw = localStorage.getItem(STORAGE_KEY_WEBHOOK_LOGS);
      if (logsRaw) {
        this.signalLogs = JSON.parse(logsRaw);
      }
    } catch {
      this.signalLogs = [];
    }

    if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (e.key === "fortress_latest_webhook_signal" && e.newValue) {
          try {
            const sig: TradingViewSignal = JSON.parse(e.newValue);
            this.broadcast(sig);
          } catch {
            // ignore malformed cross-tab payloads
          }
        }
      });
    }
  }

  /** True once the server issued a token for this session. */
  public isTokenLoaded(): boolean {
    return this.tokenLoaded;
  }

  /**
   * Fetches (or creates) the server-side webhook token. Returns false when the
   * user is not signed in — in that case the webhook endpoint is intentionally
   * unusable, because unverified tokens are rejected server-side.
   */
  public async loadRemoteToken(): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc("get_or_create_webhook_token");
      if (error || !data) return false;
      const payload = data as { success?: boolean; token?: string; signingSecret?: string };
      if (payload.success !== true || typeof payload.token !== "string") return false;
      this.userToken = payload.token;
      this.signingSecret = payload.signingSecret ?? "";
      this.tokenLoaded = true;
      return true;
    } catch {
      return false;
    }
  }

  public getWebhookToken(): string {
    return this.userToken;
  }

  public getSigningSecret(): string {
    return this.signingSecret;
  }

  /** Rotates the token server-side. Previously issued tokens stop working. */
  public async regenerateToken(): Promise<string> {
    const { data, error } = await supabase.rpc("rotate_webhook_token");
    if (error || !data) {
      throw new Error(error?.message || "Failed to rotate webhook token");
    }
    const payload = data as { success?: boolean; token?: string; signingSecret?: string; error?: string };
    if (payload.success !== true || typeof payload.token !== "string") {
      throw new Error(payload.error || "Failed to rotate webhook token");
    }
    this.userToken = payload.token;
    this.signingSecret = payload.signingSecret ?? "";
    this.tokenLoaded = true;
    return this.userToken;
  }

  public getWebhookUrl(): string {
    const supabaseUrl =
      (typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : "") || "";
    if (!supabaseUrl || !this.userToken) return "";
    return `${supabaseUrl}/functions/v1/tradingview-webhook`;
  }

  public subscribe(listener: SignalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getLogs(): TradingViewSignal[] {
    return [...this.signalLogs];
  }

  public clearLogs(): void {
    this.signalLogs = [];
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(STORAGE_KEY_WEBHOOK_LOGS);
    }
  }

  public dispatchSignal(signal: Omit<TradingViewSignal, "id" | "timestamp">): TradingViewSignal {
    const fullSignal: TradingViewSignal = {
      ...signal,
      id: `SIG-${randomId()}`,
      timestamp: Date.now(),
    };

    this.signalLogs = [fullSignal, ...this.signalLogs].slice(0, 50);
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_WEBHOOK_LOGS, JSON.stringify(this.signalLogs));
        localStorage.setItem("fortress_latest_webhook_signal", JSON.stringify(fullSignal));
      } catch {
        // ignore quota errors
      }
    }

    this.broadcast(fullSignal);
    return fullSignal;
  }

  private broadcast(signal: TradingViewSignal): void {
    this.listeners.forEach((listener) => {
      try {
        listener(signal);
      } catch (err) {
        console.error("Error in webhook signal listener:", err);
      }
    });
  }

  /**
   * Sample alert body. Includes the server-issued token and a Unix timestamp, both
   * required by the webhook validator (timestamp must be within +/- 300 s).
   */
  public getSampleJsonPayload(symbol = "BTCUSDT", action: "buy" | "sell" = "buy"): string {
    return JSON.stringify(
      {
        action,
        symbol,
        price: action === "buy" ? 64500 : 64000,
        message: `TradingView Alert: ${action.toUpperCase()} ${symbol}`,
        token: this.userToken || "<load token while signed in>",
        timestamp: Math.floor(Date.now() / 1000),
      },
      null,
      2
    );
  }
}

export const webhookService = new WebhookService();
