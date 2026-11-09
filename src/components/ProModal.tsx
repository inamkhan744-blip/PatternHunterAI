import { X, Check, Crown, ExternalLink } from "lucide-react";

export const GUMROAD_CHECKOUT_URL = "https://inamkhan08.gumroad.com/l/idbxpj";
const CHECKOUT_URL = GUMROAD_CHECKOUT_URL;

interface Props {
  open: boolean;
  onClose: () => void;
  isPro: boolean;
}

export default function ProModal({ open, onClose, isPro }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-amber-500/20 to-transparent" />
        <div className="relative p-6">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-1 mt-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <Crown className="w-6 h-6 text-slate-900" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">PatternHunter Pro</h2>
              <p className="text-sm text-slate-400">Unlock the full trading arsenal</p>
            </div>
          </div>

          <div className="mt-6 mb-6">
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold text-white">$10</span>
              <span className="text-slate-400">/month</span>
            </div>
          </div>

          <div className="space-y-3 mb-6">
            {[
              "Scan Top 50 coins for patterns simultaneously",
              "Real-time pattern alerts across all markets",
              "Advanced pattern detection (triangles, wedges, flags)",
              "Priority AI trade analysis with no rate limits",
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                  <Check className="w-3 h-3 text-green-400" />
                </div>
                <span className="text-sm text-slate-300">{feature}</span>
              </div>
            ))}
          </div>

          {isPro ? (
            <div className="w-full py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 font-semibold text-center text-sm">
              You are a Pro member
            </div>
          ) : (
            <a
              href={CHECKOUT_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-900 font-bold text-sm transition-all"
            >
              <Crown className="w-4 h-4" />
              Upgrade to Pro — $10/month
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          <p className="text-xs text-slate-500 text-center mt-4">
            Cancel anytime. Secure checkout opens in a new tab.
          </p>
        </div>
      </div>
    </div>
  );
}
