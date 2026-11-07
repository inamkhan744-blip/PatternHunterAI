import type { OrderBookData, OrderBookEntry, RecentTrade } from "../types";

type OrderBookHandler = (data: OrderBookData) => void;
type TradeHandler = (trades: RecentTrade[]) => void;
type TickerHandler = (price: number, change: number) => void;

export class BinanceWebSocket {
  private ws: WebSocket | null = null;
  private symbol: string;
  private streams: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(symbol: string, streams: string[]) {
    this.symbol = symbol.toLowerCase();
    this.streams = streams.join("/");
  }

  connect(onMessage: (data: unknown) => void): void {
    this.closed = false;
    const url = `wss://stream.binance.com:9443/stream?streams=${this.streams}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      // connected
    };

    this.ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onMessage(parsed);
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      if (!this.closed) {
        this.reconnectTimer = setTimeout(() => this.connect(onMessage), 3000);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}

export function subscribeOrderBook(symbol: string, handler: OrderBookHandler): () => void {
  const ws = new BinanceWebSocket(symbol, [`${symbol.toLowerCase()}@depth20@100ms`]);

  ws.connect((data) => {
    const msg = data as { stream: string; data: { bids: [string, string][]; asks: [string, string][] } };
    if (!msg.data?.bids || !msg.data?.asks) return;

    let bidTotal = 0;
    const bids: OrderBookEntry[] = msg.data.bids.slice(0, 15).map(([p, q]) => {
      const price = parseFloat(p);
      const quantity = parseFloat(q);
      bidTotal += quantity;
      return { price, quantity, total: bidTotal };
    });

    let askTotal = 0;
    const asks: OrderBookEntry[] = msg.data.asks.slice(0, 15).map(([p, q]) => {
      const price = parseFloat(p);
      const quantity = parseFloat(q);
      askTotal += quantity;
      return { price, quantity, total: askTotal };
    });

    const spread = asks.length > 0 && bids.length > 0 ? asks[0].price - bids[0].price : 0;
    handler({ bids, asks, spread });
  });

  return () => ws.close();
}

export function subscribeTrades(symbol: string, handler: TradeHandler): () => void {
  const ws = new BinanceWebSocket(symbol, [`${symbol.toLowerCase()}@aggTrade`]);
  const trades: RecentTrade[] = [];

  ws.connect((data) => {
    const msg = data as { stream: string; data: { a: number; p: string; q: string; T: number; m: boolean } };
    if (!msg.data?.p) return;

    const trade: RecentTrade = {
      id: msg.data.a,
      price: parseFloat(msg.data.p),
      quantity: parseFloat(msg.data.q),
      time: msg.data.T,
      isBuyerMaker: msg.data.m,
    };

    trades.unshift(trade);
    if (trades.length > 30) trades.pop();
    handler([...trades]);
  });

  return () => ws.close();
}

export function subscribeTicker(symbol: string, handler: TickerHandler): () => void {
  const ws = new BinanceWebSocket(symbol, [`${symbol.toLowerCase()}@miniTicker`]);

  ws.connect((data) => {
    const msg = data as { stream: string; data: { c: string; P: string } };
    if (!msg.data?.c) return;
    handler(parseFloat(msg.data.c), parseFloat(msg.data.P));
  });

  return () => ws.close();
}
