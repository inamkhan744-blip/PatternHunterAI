import { useEffect } from "react";
import { supabase } from "./supabase";

export interface TradingViewSignal {
  symbol: string;
  direction: string;
  price?: number | null;
  receivedAt?: string;
  signatureValidated?: boolean;
}

/**
 * Subscribes to the per-user broadcast the `tradingview-webhook` function emits.
 *
 * The webhook already sent `tradingview-signals:<user_id>` events, but nothing in
 * the app listened, so every alert was silently dropped.
 */
export function useTradingViewSignals(
  userId: string | undefined,
  onSignal: (signal: TradingViewSignal) => void
): void {
  useEffect(() => {
    if (!userId) return;

    const channel = supabase.channel(`tradingview-signals:${userId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "signal" }, (message) => {
        const payload = message.payload as TradingViewSignal | undefined;
        if (payload && typeof payload.symbol === "string" && payload.symbol.length > 0) {
          onSignal(payload);
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, onSignal]);
}
