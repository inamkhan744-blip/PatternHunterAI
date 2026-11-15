import React, { createContext, useContext, useState, useCallback } from "react";

interface ToastContextValue {
  toast: string | null;
  showToast: (message: string) => void;
  clearToast: () => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: null,
  showToast: () => {},
  clearToast: () => {},
});

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const clearToast = useCallback(() => setToast(null), []);

  return (
    <ToastContext.Provider value={{ toast, showToast, clearToast }}>
      {children}
      {toast && (
        <div className="fixed top-4 left-1/2 z-[9999] -translate-x-1/2 rounded-lg bg-slate-800 border border-slate-700 px-4 py-2 text-xs text-slate-200 shadow-xl">
          {toast}
        </div>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);