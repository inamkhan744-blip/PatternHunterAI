/**
 * WebhookService.ts
 *
 * Manages TradingView webhook endpoints, user secret tokens, and real-time
 * signal dispatching for automated trade execution.
 */

export interface TradingViewSignal {
  id: string;
  timestamp: number;
  direction: "BUY" | "SELL";
  symbol: string;
  price?: number;
  source: string;
  rawPayload?: string;
}

const STORAGE_KEY_WEBHOOK_TOKEN = "fortress_tradingview_webhook_token";
const STORAGE_KEY_WEBHOOK_LOGS = "fortress_tradingview_webhook_logs";

type SignalListener = (signal: TradingViewSignal) => void;

class WebhookService {
  private userToken: string = "";
  private listeners: Set<SignalListener> = new Set();
  private signalLogs: TradingViewSignal[] = [];

  constructor() {
    this.init();
  }

  private init(): void {
    if (typeof localStorage === "undefined") return;

    let token = localStorage.getItem(STORAGE_KEY_WEBHOOK_TOKEN);
    if (!token) {
      token = this.generateToken();
      localStorage.setItem(STORAGE_KEY_WEBHOOK_TOKEN, token);
    }
    this.userToken = token;

    try {
      const logsRaw = localStorage.getItem(STORAGE_KEY_WEBHOOK_LOGS);
      if (logsRaw) {
        this.signalLogs = JSON.parse(logsRaw);
      }
    } catch {
      this.signalLogs = [];
    }

    // Listen across browser tabs via localStorage storage event
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (e) => {
        if (e.key === "fortress_latest_webhook_signal" && e.newValue) {
          try {
            const sig: TradingViewSignal = JSON.parse(e.newValue);
            this.broadcast(sig, false);
          } catch {
            // ignore
          }
        }
      });
    }
  }

  public generateToken(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let token = "tv_";
    for (let i = 0; i < 24; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  public getWebhookToken(): string {
    if (!this.userToken) {
      this.init();
    }
    return this.userToken;
  }

  public regenerateToken(): string {
    const newToken = this.generateToken();
    this.userToken = newToken;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY_WEBHOOK_TOKEN, newToken);
    }
    return newToken;
  }

  public getWebhookUrl(): string {
    const supabaseUrl =
      (typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : "") ||
      "https://api.fortress-trading.internal";
    const token = this.getWebhookToken();
    return `${supabaseUrl}/functions/v1/tradingview-webhook?token=${token}`;
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
      id: `SIG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: Date.now(),
    };

    this.signalLogs = [fullSignal, ...this.signalLogs].slice(0, 50);
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(STORAGE_KEY_WEBHOOK_LOGS, JSON.stringify(this.signalLogs));
        localStorage.setItem("fortress_latest_webhook_signal", JSON.stringify(fullSignal));
      } catch {
        // ignore
      }
    }

    this.broadcast(fullSignal, true);
    return fullSignal;
  }

  private broadcast(signal: TradingViewSignal, _isOrigin: boolean): void {
    this.listeners.forEach((listener) => {
      try {
        listener(signal);
      } catch (err) {
        console.error("Error in webhook signal listener:", err);
      }
    });
  }

  public getSampleJsonPayload(symbol = "BTCUSDT", action: "buy" | "sell" = "buy"): string {
    return JSON.stringify(
      {
        action,
        symbol,
        price: action === "buy" ? 64500 : 64000,
        message: `TradingView Alert: ${action.toUpperCase()} ${symbol}`,
        token: this.getWebhookToken(),
      },
      null,
      2
    );
  }
}

export const webhookService = new WebhookService();
