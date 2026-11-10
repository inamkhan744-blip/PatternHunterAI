/**
 * PushNotification.ts
 *
 * Enterprise PWA & Web Push Notification Service.
 * Leverages the browser Web Notification API and Service Worker registration
 * to trigger native push notifications when trades execute or patterns are detected,
 * even when the app is in the background or minimized.
 */

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

class PushNotificationService {
  private permission: NotificationPermission = "default";
  private isSupported: boolean = false;

  constructor() {
    if (typeof window !== "undefined" && "Notification" in window) {
      this.isSupported = true;
      this.permission = Notification.permission;
    }
  }

  public checkSupport(): boolean {
    return this.isSupported;
  }

  public getPermission(): NotificationPermission {
    if (typeof window !== "undefined" && "Notification" in window) {
      this.permission = Notification.permission;
    }
    return this.permission;
  }

  public async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported) return "denied";
    try {
      const perm = await Notification.requestPermission();
      this.permission = perm;
      return perm;
    } catch {
      return "denied";
    }
  }

  /**
   * Dispatches a push notification via Service Worker (if registered)
   * or falls back to native Notification constructor.
   */
  public async sendNotification(payload: NotificationPayload): Promise<boolean> {
    if (!this.isSupported) return false;

    // Check if permission granted; if not, do not throw
    if (this.permission !== "granted") {
      const current = Notification.permission;
      if (current !== "granted") return false;
      this.permission = "granted";
    }

    const options: NotificationOptions = {
      body: payload.body,
      icon: payload.icon || "https://images.unsplash.com/photo-1622979135225-d2ba269bc1df?w=192&auto=format&fit=crop&q=80",
      badge: payload.badge || "https://images.unsplash.com/photo-1622979135225-d2ba269bc1df?w=192&auto=format&fit=crop&q=80",
      tag: payload.tag || `fortress-${Date.now()}`,
      data: payload.data,
    };

    try {
      // 1. Try Service Worker showNotification (works in background / PWA)
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration && "showNotification" in registration) {
          await registration.showNotification(payload.title, options);
          return true;
        }
      }

      // 2. Direct Window Notification fallback
      new Notification(payload.title, options);
      return true;
    } catch (err) {
      console.warn("Failed to dispatch push notification:", err);
      return false;
    }
  }

  /**
   * Notification for trade execution (Auto-Pilot, Manual, or Webhook)
   */
  public async notifyTradeExecution(params: {
    symbol: string;
    direction: "LONG" | "SHORT" | "BUY" | "SELL";
    entryPrice: number;
    source: string;
    mode: "REAL" | "PAPER";
  }): Promise<void> {
    const dir = params.direction.toUpperCase();
    const modeBadge = params.mode === "REAL" ? "🔴 [LIVE EXCHANGE]" : "🟡 [SIMULATED]";
    await this.sendNotification({
      title: `⚡ Trade Executed: ${dir} ${params.symbol}`,
      body: `${modeBadge} ${params.source} filled at $${params.entryPrice.toLocaleString()}. Automated TP/SL active.`,
      tag: `trade-${params.symbol}-${Date.now()}`,
    });
  }

  /**
   * Notification for detected chart pattern
   */
  public async notifyPatternDetected(params: {
    symbol: string;
    patternName: string;
    direction: "bullish" | "bearish" | "neutral";
    price: number;
    confidence?: number;
  }): Promise<void> {
    const icon = params.direction === "bullish" ? "📈" : "📉";
    const conf = params.confidence ? ` (${params.confidence}% Confidence)` : "";
    await this.sendNotification({
      title: `${icon} Pattern Detected: ${params.patternName}`,
      body: `${params.symbol} at $${params.price.toLocaleString()} formed ${params.patternName}${conf}.`,
      tag: `pattern-${params.symbol}-${params.patternName}`,
    });
  }

  /**
   * Notification for Trailing Stop movement
   */
  public async notifyTrailingStopMoved(params: {
    symbol: string;
    newStopLoss: number;
    stage: "BREAK_EVEN" | "TRAILING_ATR";
  }): Promise<void> {
    const stageDesc = params.stage === "BREAK_EVEN" ? "Break-Even (1:1 RR Hit)" : "Trailing 1.5x ATR";
    await this.sendNotification({
      title: `🛡️ Stop Loss Adjusted: ${params.symbol}`,
      body: `SL safely raised to $${params.newStopLoss.toLocaleString()} [${stageDesc}] to protect capital.`,
      tag: `trailing-${params.symbol}`,
    });
  }

  /**
   * Notification for OCO Order completion
   */
  public async notifyOcoTriggered(params: {
    symbol: string;
    exitReason: "TP" | "SL";
    exitPrice: number;
    pnl: number;
  }): Promise<void> {
    const verb = params.exitReason === "TP" ? "🎯 Take Profit Hit" : "🛑 Stop Loss Hit";
    const ocoAction = params.exitReason === "TP" ? "Stop Loss automatically cancelled (OCO)" : "Take Profit automatically cancelled (OCO)";
    await this.sendNotification({
      title: `${verb}: ${params.symbol}`,
      body: `Closed at $${params.exitPrice.toLocaleString()} (PnL: $${params.pnl.toFixed(2)}). ${ocoAction}.`,
      tag: `oco-${params.symbol}-${Date.now()}`,
    });
  }
}

export const pushNotificationService = new PushNotificationService();
