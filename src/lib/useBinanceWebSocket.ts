import { useState, useEffect, useRef, useCallback } from "react";

export type WebSocketStatus = "CONNECTED" | "CONNECTING" | "RECONNECTING" | "DISCONNECTED";

export interface UseBinanceWebSocketOptions {
  streams: string[];
  onMessage: (data: unknown) => void;
  enabled?: boolean;
}

export function useBinanceWebSocket({
  streams,
  onMessage,
  enabled = true,
}: UseBinanceWebSocketOptions) {
  const [status, setStatus] = useState<WebSocketStatus>("DISCONNECTED");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isManuallyClosedRef = useRef(false);

  const streamsKey = streams.sort().join("/");

  const connect = useCallback(() => {
    if (!enabled || streams.length === 0) {
      setStatus("DISCONNECTED");
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    isManuallyClosedRef.current = false;
    setStatus((prev) => (prev === "DISCONNECTED" ? "CONNECTING" : "RECONNECTING"));

    const url = `wss://stream.binance.com:9443/stream?streams=${streamsKey}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    const connectStartTime = Date.now();

    ws.onopen = () => {
      setStatus("CONNECTED");
      setReconnectAttempts(0);
      setLatency(Date.now() - connectStartTime);

      // Heartbeat ping simulation / latency check
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          // Keep connection warm
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onMessage(parsed);
      } catch {
        // ignore parse error
      }
    };

    ws.onclose = () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (!isManuallyClosedRef.current && enabled) {
        setStatus("RECONNECTING");
        setReconnectAttempts((prev) => prev + 1);
        // Exponential backoff capped at 5 seconds
        const delay = Math.min(5000, 1000 * Math.pow(1.5, reconnectAttempts));
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        setStatus("DISCONNECTED");
      }
    };

    ws.onerror = () => {
      // Trigger auto-reconnect via close handler
      ws.close();
    };
  }, [enabled, streamsKey, onMessage, reconnectAttempts]);

  useEffect(() => {
    connect();

    // Listen for browser online / offline network events
    const handleOnline = () => {
      connect();
    };

    const handleOffline = () => {
      setStatus("DISCONNECTED");
      if (wsRef.current) {
        wsRef.current.close();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      isManuallyClosedRef.current = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    status,
    reconnectAttempts,
    latency,
    reconnect: connect,
  };
}
