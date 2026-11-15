import React, { useEffect, useSyncExternalStore } from "react";
import { paperTradingEngine } from "./PaperTrading";
import { isLiveTradingConfigured } from "./CredentialVault";

interface WalletBalanceContextValue {
  balance: number;
  setBalance: (value: number) => void;
}

/**
 * A tiny global store instead of a React context snapshot. The paper ledger is
 * the source of truth for the virtual balance; every open/close/reset emits a
 * change and every mounted consumer re-renders immediately.
 */
let currentBalance = paperTradingEngine.getAccount().balance;
let paperSubscriptionActive = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A broken consumer must not stop the rest of the UI from updating.
    }
  });
}

function setBalance(value: number): void {
  if (!Number.isFinite(value)) return;
  const next = Number(value.toFixed(8));
  if (next === currentBalance) return;
  currentBalance = next;
  emit();
}

function getBalance(): number {
  return currentBalance;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!paperSubscriptionActive) {
    paperSubscriptionActive = true;
    paperTradingEngine.subscribe(() => {
      if (!isLiveTradingConfigured()) {
        setBalance(paperTradingEngine.getAccount().balance);
      }
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

function hydrateFromLedger(): void {
  if (!isLiveTradingConfigured()) {
    setBalance(paperTradingEngine.getAccount().balance);
  }
}

export const WalletBalanceProvider: React.FC<{
  children: React.ReactNode;
  initialBalance?: number;
}> = ({ children, initialBalance }) => {
  useEffect(() => {
    if (typeof initialBalance === "number" && Number.isFinite(initialBalance)) {
      setBalance(initialBalance);
    } else {
      hydrateFromLedger();
    }
  }, [initialBalance]);

  return <>{children}</>;
};

export const useWalletBalance = (): WalletBalanceContextValue => {
  const balance = useSyncExternalStore(subscribe, getBalance, getBalance);
  return { balance, setBalance };
};
