const AFFILIATE_REF = "YOUR_ID";
const WEB_URL = `https://www.binance.com/en/register?ref=${AFFILIATE_REF}`;
const ANDROID_INTENT = `intent://www.binance.com/en/register?ref=${AFFILIATE_REF}#Intent;package=com.binance.dev;scheme=https;end`;
const IOS_DEEP_LINK = `binance://`;
const IOS_WEB_FALLBACK = `https://apps.apple.com/app/binance/id1436142776`;

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop|Mobile/i.test(navigator.userAgent);
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Attempts to open the Binance app via deep link on mobile.
 * Falls back to the web affiliate link after 2 seconds if the app isn't installed.
 * On desktop, opens the web affiliate link directly.
 */
export function openBinanceApp(): void {
  if (!isMobile()) {
    window.open(WEB_URL, "_blank", "noopener,noreferrer");
    return;
  }

  if (isIOS()) {
    // iOS: try the custom URL scheme, fall back after 2s
    const start = Date.now();
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = IOS_DEEP_LINK;
    document.body.appendChild(iframe);

    const cleanup = () => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };

    window.setTimeout(() => {
      cleanup();
      // If less than 2s elapsed, the page was likely hidden (app opened).
      // If the timer fires at ~2s, the app probably isn't installed.
      const elapsed = Date.now() - start;
      if (elapsed < 2200) {
        // App opened — do nothing
      } else {
        // App not installed — open App Store fallback
        window.location.href = IOS_WEB_FALLBACK;
      }
    }, 2000);

    // Safety: clean up the iframe after 3s regardless
    window.setTimeout(cleanup, 3000);
  } else {
    // Android: use intent:// which auto-falls back to Play Store
    window.location.href = ANDROID_INTENT;

    // Fallback to web after 2s if intent didn't navigate away
    window.setTimeout(() => {
      window.open(WEB_URL, "_blank", "noopener,noreferrer");
    }, 2000);
  }
}

export { WEB_URL };
