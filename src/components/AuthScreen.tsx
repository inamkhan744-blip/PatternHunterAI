import React, { useState } from "react";
import {
  Activity,
  Mail,
  Lock,
  Loader2,
  TrendingUp,
  Shield,
  Zap,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { useAuth } from "../lib/auth";

export default function AuthScreen() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const result = await signIn(email.trim(), password);
        if (result.error) {
          setError(result.error);
        }
      } else {
        const result = await signUp(email.trim(), password);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccessMessage("Account created successfully! Check your inbox if confirmation is required.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication request failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google Sign-In failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-white flex flex-col justify-center items-center px-4 py-8 relative overflow-hidden font-sans">
      {/* Background glow effects */}
      <div className="absolute top-1/4 -left-40 w-96 h-96 bg-cyan-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-40 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Main card */}
      <div className="relative w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-cyan-950/40 backdrop-blur-xl">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 via-cyan-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-cyan-950/60 mb-3">
            <Activity className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            PatternHunter <span className="text-cyan-400 font-mono">AI</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-mono">
            Institutional Crypto Algorithmic Terminal
          </p>
        </div>

        {/* Tab switch */}
        <div className="grid grid-cols-2 p-1 mb-6 rounded-xl bg-slate-950 border border-slate-800 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
              setSuccessMessage(null);
            }}
            className={`py-2 rounded-lg transition-all ${
              mode === "login"
                ? "bg-slate-800 text-cyan-400 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setError(null);
              setSuccessMessage(null);
            }}
            className={`py-2 rounded-lg transition-all ${
              mode === "signup"
                ? "bg-slate-800 text-cyan-400 shadow-sm"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Error / Success messages */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/80 border border-red-500/50 text-red-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[#00ff66] shrink-0" />
            <span className="flex-1">{successMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@domain.com"
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-400 transition"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-300 block mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl pl-10 pr-10 py-2.5 text-sm text-white placeholder:text-slate-600 outline-none focus:border-cyan-400 transition font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-xs uppercase tracking-wider transition shadow-lg shadow-cyan-950/50 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 text-slate-950" />
                <span>{mode === "login" ? "Enter Fortress Dashboard" : "Create Account & Start"}</span>
              </>
            )}
          </button>
        </form>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-slate-800" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500">Or continue with</span>
          <div className="flex-1 h-px bg-slate-800" />
        </div>

        {/* Google OAuth Button */}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="w-full py-2.5 px-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 transition flex items-center justify-center gap-2.5 disabled:opacity-50"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          <span>Continue with Google</span>
        </button>

        {/* Institutional safety note */}
        <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-center gap-2 text-[11px] text-slate-500 font-mono">
          <Shield className="w-3.5 h-3.5 text-cyan-500/70" />
          <span>Supabase Auth & AES-256 Vault Encryption</span>
        </div>
      </div>
    </div>
  );
}
