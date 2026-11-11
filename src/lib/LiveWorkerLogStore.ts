export type LogLevel = "info" | "warn" | "error" | "success";

export interface WorkerLog {
  id: string;
  timestamp: string;
  rawTime: number;
  level: LogLevel;
  message: string;
  symbol?: string;
  details?: Record<string, unknown>;
}

type LogSubscriber = (logs: WorkerLog[], latestLog: WorkerLog) => void;

class LiveWorkerLogStoreClass {
  private logs: WorkerLog[] = [];
  private subscribers: Set<LogSubscriber> = new Set();
  private maxLogs: number = 200;
  private lastLoggedMessage: string = "";
  private lastLoggedTime: number = 0;

  constructor() {
    this.addLog("Auto-Pilot Diagnostic Worker initialized.", "info");
  }

  public addLog(
    message: string,
    level: LogLevel = "info",
    details?: { symbol?: string; [key: string]: unknown }
  ): WorkerLog {
    const now = Date.now();
    // Throttle exact identical messages if sent within 2 seconds to avoid console/UI spam
    if (this.lastLoggedMessage === message && now - this.lastLoggedTime < 2000) {
      return this.logs[0];
    }

    this.lastLoggedMessage = message;
    this.lastLoggedTime = now;

    const timeString = new Date(now).toISOString().substring(11, 19);
    const logItem: WorkerLog = {
      id: `log-${now}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: timeString,
      rawTime: now,
      level,
      message,
      symbol: details?.symbol,
      details,
    };

    this.logs = [logItem, ...this.logs].slice(0, this.maxLogs);
    this.notifySubscribers(logItem);
    return logItem;
  }

  public getLogs(): WorkerLog[] {
    return [...this.logs];
  }

  public getLatestLog(): WorkerLog | null {
    return this.logs.length > 0 ? this.logs[0] : null;
  }

  public clear(): void {
    this.logs = [];
    this.notifySubscribers({
      id: `clear-${Date.now()}`,
      timestamp: new Date().toISOString().substring(11, 19),
      rawTime: Date.now(),
      level: "info",
      message: "Diagnostics log cleared.",
    });
  }

  public subscribe(fn: LogSubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private notifySubscribers(latestLog: WorkerLog): void {
    const currentLogs = [...this.logs];
    for (const sub of this.subscribers) {
      try {
        sub(currentLogs, latestLog);
      } catch (err) {
        console.error("Error in LiveWorkerLogStore subscriber:", err);
      }
    }
  }
}

export const liveWorkerLogStore = new LiveWorkerLogStoreClass();
export const LiveWorkerLogStore = liveWorkerLogStore;
