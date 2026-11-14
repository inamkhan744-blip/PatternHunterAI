import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

interface Props {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "success" | "neutral";
}

const variantStyles = {
  danger: {
    icon: "text-red-400",
    iconBg: "bg-red-500/15 border-red-500/30",
    confirm: "bg-red-500 hover:bg-red-400 text-white shadow-red-500/40",
  },
  success: {
    icon: "text-emerald-400",
    iconBg: "bg-emerald-500/15 border-emerald-500/30",
    confirm: "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/40",
  },
  neutral: {
    icon: "text-blue-400",
    iconBg: "bg-blue-500/15 border-blue-500/30",
    confirm: "bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/40",
  },
};

export default function ConfirmActionModal({
  isOpen,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  variant = "neutral",
}: Props) {
  if (!isOpen) return null;

  const styles = variantStyles[variant];
  const Icon = variant === "danger" ? AlertTriangle : variant === "success" ? CheckCircle2 : Info;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900/95 shadow-2xl shadow-black/40 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${styles.iconBg}`}>
            <Icon className={`w-5 h-5 ${styles.icon}`} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-white">{title}</h3>
            <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{message}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          {cancelText && (
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold shadow-lg transition ${styles.confirm}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}