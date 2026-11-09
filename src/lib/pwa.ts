import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

// Global store for the deferred prompt event
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Prevent the default browser mini-infobar or install dialog
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyListeners();
  });
}

/**
 * Hook to manage PWA installation state and trigger the prompt.
 */
export function usePWAInstall() {
  const [canInstall, setCanInstall] = useState<boolean>(!!deferredPrompt);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);

  useEffect(() => {
    const checkStandalone = () => {
      const isStandaloneMode =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsStandalone(Boolean(isStandaloneMode));
    };

    checkStandalone();

    const handleChange = () => {
      setCanInstall(!!deferredPrompt);
      checkStandalone();
    };

    listeners.add(handleChange);
    window.addEventListener("resize", checkStandalone);

    return () => {
      listeners.delete(handleChange);
      window.removeEventListener("resize", checkStandalone);
    };
  }, []);

  const triggerInstall = async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferredPrompt) {
      return "unavailable";
    }

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        deferredPrompt = null;
        setCanInstall(false);
      }
      return choice.outcome;
    } catch (err) {
      console.warn("PWA install prompt failed or was aborted:", err);
      return "unavailable";
    }
  };

  return {
    canInstall,
    isStandalone,
    triggerInstall,
  };
}
