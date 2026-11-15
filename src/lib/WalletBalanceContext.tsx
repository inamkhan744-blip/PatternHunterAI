import React, { createContext, useContext, useState } from "react";

interface WalletBalanceContextValue {
  balance: number;
  setBalance: (value: number) => void;
}

const WalletBalanceContext = createContext<WalletBalanceContextValue>({
  balance: 0,
  setBalance: () => {},
});

export const WalletBalanceProvider: React.FC<{
  children: React.ReactNode;
  initialBalance: number;
}> = ({ children, initialBalance }) => {
  const [balance, setBalance] = useState(initialBalance);
  return (
    <WalletBalanceContext.Provider value={{ balance, setBalance }}>
      {children}
    </WalletBalanceContext.Provider>
  );
};

export const useWalletBalance = () => useContext(WalletBalanceContext);