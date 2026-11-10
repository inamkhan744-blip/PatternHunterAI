import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Mic, Loader2, Sparkles, Trash2, Volume2 } from "lucide-react";
import type { ChatMessage, Coin } from "../types";
import { COINS, PRO_COINS } from "../constants";
import { supabase } from "../lib/supabase";

interface Props {
  coin: Coin;
  price: number | null;
  change24h: number | null;
  rsi: number | null;
  trend: string | null;
  pattern: string | null;
  fearGreed: number | null;
  onShowCoin: (symbol: string) => void;
}

const ALL_COINS = [...COINS, ...PRO_COINS];

export default function AIChat({
  coin,
  price,
  change24h,
  rsi,
  trend,
  pattern,
  fearGreed,
  onShowCoin,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<unknown>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    setMessages([{
      role: "assistant",
      content: `Hi! I'm PatternHunter AI. I can see you're viewing ${coin.symbol}/USDT at ${price ? "$" + price.toFixed(2) : "loading..."}. Ask me about market conditions, patterns, or say "Show ETH chart" to switch coins. You can also use voice commands with the mic button.`,
      timestamp: Date.now(),
    }]);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    const actionMatch = text.match(/\b(?:show|display|open|view)\s+(\w+)\s*(?:chart)?/i);
    if (actionMatch) {
      const sym = actionMatch[1].toUpperCase();
      const found = ALL_COINS.find((c) => c.symbol === sym);
      if (found) {
        onShowCoin(sym);
        const reply: ChatMessage = {
          role: "assistant",
          content: `Switching to ${sym}/USDT chart. Here's the live view — let me know if you want analysis.`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, reply]);
        setLoading(false);
        return;
      }
    }

    const buyMatch = text.match(/\b(?:buy|sell|long|short)\s+(\w+)/i);
    if (buyMatch) {
      const sym = buyMatch[1].toUpperCase();
      const found = ALL_COINS.find((c) => c.symbol === sym);
      if (found && price) {
        onShowCoin(sym);
      }
    }

    const currentContext = {
      coin: coin.symbol,
      price: price ?? undefined,
      change24h: change24h ?? undefined,
      rsi: rsi ?? undefined,
      trend: trend ?? undefined,
      pattern: pattern ?? undefined,
      fearGreed: fearGreed ?? undefined,
    };

    try {
      const { data, error: invokeError } = await supabase.functions.invoke("ai-chat", {
        body: {
          action: "chat",
          message: text,
          marketContext: currentContext,
          conversationHistory: messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
        },
      });

      if (invokeError) {
        throw new Error(invokeError.message || "AI backend service error");
      }

      // Check wrapped format { success: true, data: { ... } } or { response: "..." }
      const resolvedReply =
        data?.response ||
        (data?.data && typeof data.data === "string" ? data.data : data?.data?.response || data?.data?.explanation || data?.data?.text) ||
        null;

      if (data?.unavailable || !resolvedReply) {
        throw new Error(data?.error || "AI edge unavailable");
      }

      const replyText: string = resolvedReply;
      const actionTag = replyText.match(/\[ACTION:show_chart:(\w+)\]/);
      if (actionTag) {
        const sym = actionTag[1].toUpperCase();
        onShowCoin(sym);
      }
      const cleanText = replyText.replace(/\[ACTION:show_chart:\w+\]/g, "").trim();
      const reply: ChatMessage = { role: "assistant", content: cleanText, timestamp: Date.now() };
      setMessages((prev) => [...prev, reply]);
    } catch {
      const reply: ChatMessage = {
        role: "assistant",
        content: `Direct Technical Overview: ${coin.symbol} is currently trading at ${price ? "$" + price.toFixed(2) : "N/A"}. Market metrics show RSI: ${rsi?.toFixed(1) ?? "N/A"}, Trend structure: ${trend ?? "Consolidation"}, Active Pattern: ${pattern ?? "None detected"}.`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, reply]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages, coin, price, rsi, trend, pattern, onShowCoin, change24h, fearGreed]);

  const toggleVoice = useCallback(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => unknown;
      webkitSpeechRecognition?: new () => unknown;
    };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) {
      setError("Voice recognition not supported in this browser.");
      return;
    }

    if (listening) {
      (recognitionRef.current as { stop: () => void })?.stop();
      setListening(false);
      return;
    }

    const recognition = new SR() as {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onresult: ((event: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: { results: { 0: { 0: { transcript: string } } } }) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      setListening(false);
      sendMessage(transcript);
    };

    recognition.onerror = () => {
      setListening(false);
      setError("Voice recognition error. Please try again.");
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening, sendMessage]);

  const speak = (text: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      window.speechSynthesis.speak(utterance);
    }
  };

  const clearChat = () => {
    setMessages([{
      role: "assistant",
      content: `Chat cleared. I'm viewing ${coin.symbol}/USDT. How can I help?`,
      timestamp: Date.now(),
    }]);
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-4 flex flex-col" style={{ height: "calc(100vh - 140px)" }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            AI Chat Assistant
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Ask market questions or use voice commands</p>
        </div>
        <button
          onClick={clearChat}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </div>

      <div className="flex-1 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                  msg.role === "user"
                    ? "bg-cyan-500/20 text-white"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                {msg.role === "assistant" && (
                  <button
                    onClick={() => speak(msg.content)}
                    className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500 hover:text-cyan-400 transition-colors"
                  >
                    <Volume2 className="w-3 h-3" />
                    Read aloud
                  </button>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-slate-800 rounded-xl px-4 py-2.5">
                <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
              </div>
            </div>
          )}
          {error && (
            <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-slate-800 p-3">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleVoice}
              className={`p-2.5 rounded-lg border transition-colors shrink-0 ${
                listening
                  ? "bg-red-500/20 border-red-500/30 text-red-400 animate-pulse"
                  : "bg-slate-800 border-slate-700 text-slate-400 hover:text-cyan-400"
              }`}
              title="Voice command"
            >
              <Mic className="w-4 h-4" />
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder={listening ? "Listening..." : "Ask about the market, or say 'Show ETH chart'..."}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-500 transition-colors"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              className="p-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-900 transition-colors disabled:opacity-50 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          {listening && (
            <p className="text-xs text-red-400 mt-2 text-center animate-pulse">
              Listening... speak your command
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
