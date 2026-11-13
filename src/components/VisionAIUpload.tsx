import React, { useState, useRef, useCallback } from "react";
import {
  X,
  UploadCloud,
  FileImage,
  Sparkles,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Target,
  Shield,
  Eye,
  Zap,
} from "lucide-react";
import { generateAIResponse, parseAIJson } from "../lib/AIService";

export interface VisionAnalysisResult {
  trend: "Bullish" | "Bearish" | "Sideways/Consolidation";
  trendReason: string;
  supportResistance: {
    support: string[];
    resistance: string[];
  };
  patterns: Array<{
    name: string;
    direction: "bullish" | "bearish" | "neutral";
    confidence: number;
    description: string;
  }>;
  keyTakeaway: string;
  suggestedAction?: "LONG" | "SHORT" | "WAIT";
  invalidationLevel?: string;
  modelUsed?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  activeSymbol?: string;
}

const VALID_TRENDS = new Set(["Bullish", "Bearish", "Sideways/Consolidation"]);
const VALID_ACTIONS = new Set(["LONG", "SHORT", "WAIT"]);
const MAX_LIST_ITEMS = 12;

function asText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const cleaned = Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .trim();
  return cleaned.slice(0, maxChars);
}

function asLevelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? asText(v, 40) : typeof v === "number" ? String(v) : ""))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

/**
 * Vision output is model-generated, so it is schema-validated before rendering.
 * Anything outside the documented enums/ranges is rejected instead of displayed.
 */
function parseVisionResult(raw: unknown): VisionAnalysisResult {
  if (!raw || typeof raw !== "object") throw new Error("Vision AI returned an empty result.");
  const obj = raw as Record<string, unknown>;

  const trend = asText(obj.trend, 40) as VisionAnalysisResult["trend"];
  if (!VALID_TRENDS.has(trend)) {
    throw new Error("Vision AI returned an unrecognized trend value. Analysis discarded.");
  }

  const sr = (obj.supportResistance ?? {}) as Record<string, unknown>;
  const patternsRaw = Array.isArray(obj.patterns) ? obj.patterns : [];
  const patterns = patternsRaw
    .slice(0, MAX_LIST_ITEMS)
    .map((p) => {
      const pat = (p ?? {}) as Record<string, unknown>;
      const direction = asText(pat.direction, 16).toLowerCase();
      const confidence = Number(pat.confidence);
      return {
        name: asText(pat.name, 80) || "Unnamed pattern",
        direction: (direction === "bullish" || direction === "bearish" ? direction : "neutral") as
          | "bullish"
          | "bearish"
          | "neutral",
        confidence: Number.isFinite(confidence) ? Math.min(100, Math.max(0, Math.round(confidence))) : 0,
        description: asText(pat.description, 400),
      };
    });

  const actionRaw = asText(obj.suggestedAction, 16).toUpperCase();
  const suggestedAction = VALID_ACTIONS.has(actionRaw)
    ? (actionRaw as "LONG" | "SHORT" | "WAIT")
    : "WAIT";

  return {
    trend,
    trendReason: asText(obj.trendReason, 600),
    supportResistance: {
      support: asLevelList(sr.support),
      resistance: asLevelList(sr.resistance),
    },
    patterns,
    keyTakeaway: asText(obj.keyTakeaway, 900),
    suggestedAction,
    invalidationLevel: asText(obj.invalidationLevel, 60) || undefined,
  };
}
export default function VisionAIUpload({ open, onClose, activeSymbol = "BTCUSDT" }: Props) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>("image/png");
  const [fileName, setFileName] = useState<string>("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<VisionAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Gemini's inline_data payload tops out around ~3 MB of base64. Charts are usually
   * far larger than that, so images are downscaled locally before upload instead of
   * being rejected after the user picked a perfectly valid screenshot.
   */
  const downscaleDataUrl = useCallback(async (dataUrl: string, originalMime: string): Promise<string> => {
    const MAX_CHARS = 3_000_000; // ≈2.2 MB binary, below the backend's 4M-char cap
    if (dataUrl.length <= MAX_CHARS) return dataUrl;

    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not read the selected image."));
        image.src = dataUrl;
      });

      const maxDimension = 1600;
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return dataUrl;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Charts stay legible as high-quality JPEG and compress far better than PNG.
      const outputMime = originalMime === "image/png" ? "image/jpeg" : originalMime;
      let out = canvas.toDataURL(outputMime, 0.88);
      if (out.length > MAX_CHARS) out = canvas.toDataURL("image/jpeg", 0.72);
      if (out.length > MAX_CHARS) out = canvas.toDataURL("image/jpeg", 0.55);
      return out;
    } catch {
      return dataUrl;
    }
  }, []);

  const handleFileProcess = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file (PNG, JPG, WEBP).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Image size exceeds 8MB. Please choose a smaller chart screenshot.");
      return;
    }

    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const prepared = await downscaleDataUrl(dataUrl, file.type || "image/png");
      const resolvedMime =
        prepared.slice(5, prepared.indexOf(";")) || file.type || "image/png";
      setImageMime(resolvedMime === "image/jpg" ? "image/jpeg" : resolvedMime);
      setSelectedImage(prepared);
      setResult(null);
    };
    reader.readAsDataURL(file);
  }, [downscaleDataUrl]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileProcess(e.dataTransfer.files[0]);
    }
  }, [handleFileProcess]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (e.clipboardData.files && e.clipboardData.files[0]) {
      handleFileProcess(e.clipboardData.files[0]);
    }
  }, [handleFileProcess]);

  /**
   * Run Gemini Vision analysis directly against the Gemini REST API.
   * Vision is Gemini-only: AIService routes any image request to Gemini even when
   * DeepSeek or Groq is the active text provider.
   */
  const analyzeChartWithVision = async () => {
    if (!selectedImage) return;

    setAnalyzing(true);
    setError(null);

    const prompt = `Carefully examine this candlestick chart image for ${activeSymbol}.
Identify:
1. Trend: Overall trend ("Bullish", "Bearish", or "Sideways/Consolidation") with an explanation.
2. Support & Resistance: The key visible support levels/zones and resistance levels/zones.
3. Patterns: All visible chart patterns with direction ("bullish"|"bearish"|"neutral"), confidence (50-99), and description.
4. Key Takeaway: Concise trading recommendation, suggested action ("LONG"|"SHORT"|"WAIT"), and invalidation/stop-loss level.

Respond STRICTLY in valid JSON matching this schema:
{
  "trend": "Bullish" | "Bearish" | "Sideways/Consolidation",
  "trendReason": "Brief explanation of price structure",
  "supportResistance": { "support": ["Level 1"], "resistance": ["Level 1"] },
  "patterns": [{ "name": "Pattern Name", "direction": "bullish", "confidence": 85, "description": "Details" }],
  "suggestedAction": "LONG" | "SHORT" | "WAIT",
  "invalidationLevel": "Price level that invalidates this setup",
  "keyTakeaway": "1-2 sentence actionable summary."
}`;

    const systemPrompt =
      "You are a Senior Crypto Technical Analyst & Vision AI specialized in reading candlestick charts, " +
      "order books, SMC liquidity zones, and technical patterns. Only describe what is visible in the image; " +
      "never invent price levels or claim live market data.";

    try {
      const aiResult = await generateAIResponse(prompt, systemPrompt, selectedImage, {
        imageMimeType: imageMime || "image/png",
        temperature: 0.2,
        maxOutputTokens: 800,
        json: true,
      });

      const parsed = parseVisionResult(parseAIJson(aiResult.text));
      parsed.modelUsed = `Gemini Vision (${aiResult.model})`;
      setResult(parsed);
    } catch (err) {
      console.error("[Vision AI] generateAIResponse failed:", err);
      setResult(null);
      setError(
        err instanceof Error
          ? `Vision analysis unavailable: ${err.message}`
          : "Vision analysis unavailable. Please retry with a smaller PNG/JPG screenshot."
      );
    } finally {
      setAnalyzing(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
      onPaste={handlePaste}
    >
      <div className="relative w-full max-w-4xl bg-[#090d16] border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-950/50 overflow-hidden flex flex-col max-h-[92vh] text-white font-sans">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-[#060910] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-950/50">
              <Eye className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-wider uppercase font-mono">
                  VISION AI CHART INSPECTOR
                </h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-cyan-400" /> GEMINI MULTIMODAL
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Drag & drop or paste any trading chart screenshot for instant AI computer vision pattern recognition
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {error && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Upload Area / Image Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Upload / Drag & Drop Dropzone */}
            <div className={`${selectedImage ? "lg:col-span-5" : "lg:col-span-12"} flex flex-col`}>
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-200 text-center ${
                  dragActive
                    ? "border-cyan-400 bg-cyan-500/10 scale-[0.99]"
                    : "border-slate-800 bg-[#0d121f] hover:border-cyan-500/50 hover:bg-slate-900/60"
                } ${selectedImage ? "h-64" : "py-12"}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileProcess(e.target.files[0]);
                    }
                  }}
                />

                {selectedImage ? (
                  <div className="relative w-full h-full flex flex-col items-center justify-center">
                    <img
                      src={selectedImage}
                      alt="Uploaded Chart"
                      className="max-h-52 w-auto object-contain rounded-lg border border-slate-800 shadow-md"
                    />
                    <span className="text-[11px] text-cyan-400 font-medium mt-2 flex items-center gap-1">
                      <FileImage className="w-3.5 h-3.5" />
                      {fileName || "Chart Screenshot"} · Click or drop to replace
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                      <UploadCloud className="w-7 h-7" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Drop your chart screenshot here, or <span className="text-cyan-400 underline">browse</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Supports PNG, JPG, or WEBP up to 8MB. Paste (Ctrl+V) anywhere.
                      </p>
                    </div>

                    <p className="text-[11px] text-slate-600 mt-1">
                      Use a real screenshot from your TradingView/Binance chart — sample images are not analysed
                      as if they were live charts.
                    </p>
                  </div>
                )}
              </div>

              {selectedImage && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={analyzeChartWithVision}
                    disabled={analyzing}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs uppercase tracking-wider transition shadow-lg shadow-cyan-950/40 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {analyzing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                        Scanning Chart Pixels...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-slate-950" />
                        Run Vision AI Analysis
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setSelectedImage(null);
                      setResult(null);
                      setFileName("");
                    }}
                    className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                    title="Remove Image"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* Right Analysis Breakdown */}
            {selectedImage && (
              <div className="lg:col-span-7 flex flex-col justify-between">
                {analyzing ? (
                  <div className="h-full min-h-[300px] rounded-2xl bg-[#0d121f] border border-slate-800 flex flex-col items-center justify-center p-8 text-center">
                    <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                      Gemini Multimodal Reasoning
                    </h3>
                    <p className="text-xs text-slate-400 mt-2 max-w-sm">
                      Detecting candle bodies, wicks, support/resistance reaction zones, and order block imbalances...
                    </p>
                  </div>
                ) : result ? (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    {/* Trend & Action Row */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3.5 rounded-xl bg-[#0d121f] border border-slate-800">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">
                          Detected Trend
                        </span>
                        <div className="flex items-center gap-2">
                          {result.trend === "Bullish" ? (
                            <TrendingUp className="w-4 h-4 text-green-400" />
                          ) : result.trend === "Bearish" ? (
                            <TrendingDown className="w-4 h-4 text-red-400" />
                          ) : (
                            <Minus className="w-4 h-4 text-slate-400" />
                          )}
                          <span
                            className={`text-sm font-bold font-mono ${
                              result.trend === "Bullish"
                                ? "text-green-400"
                                : result.trend === "Bearish"
                                ? "text-red-400"
                                : "text-slate-300"
                            }`}
                          >
                            {result.trend}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                          {result.trendReason}
                        </p>
                      </div>

                      <div className="p-3.5 rounded-xl bg-[#0d121f] border border-slate-800">
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">
                          Strategic Action
                        </span>
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4 text-cyan-400" />
                          <span
                            className={`text-sm font-bold font-mono ${
                              result.suggestedAction === "LONG"
                                ? "text-green-400"
                                : result.suggestedAction === "SHORT"
                                ? "text-red-400"
                                : "text-amber-400"
                            }`}
                          >
                            {result.suggestedAction || "WAIT"}
                          </span>
                        </div>
                        {result.invalidationLevel && (
                          <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                            Invalidation: <strong className="text-red-400">{result.invalidationLevel}</strong>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Support & Resistance Zones */}
                    <div className="p-4 rounded-xl bg-[#0d121f] border border-slate-800">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
                        <Shield className="w-3.5 h-3.5 text-cyan-400" />
                        Key Support & Resistance Levels
                      </span>

                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
                          <span className="text-[10px] text-green-400 font-bold block mb-1">
                            SUPPORT LEVELS / DEMAND
                          </span>
                          <ul className="space-y-1">
                            {result.supportResistance.support.map((lvl, i) => (
                              <li key={i} className="text-slate-300 text-[11px] flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                {lvl}
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
                          <span className="text-[10px] text-red-400 font-bold block mb-1">
                            RESISTANCE LEVELS / SUPPLY
                          </span>
                          <ul className="space-y-1">
                            {result.supportResistance.resistance.map((lvl, i) => (
                              <li key={i} className="text-slate-300 text-[11px] flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                {lvl}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* Identified Patterns */}
                    <div className="p-4 rounded-xl bg-[#0d121f] border border-slate-800 space-y-2.5">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-amber-400" />
                        Identified Technical Patterns
                      </span>

                      <div className="space-y-2">
                        {result.patterns.map((pat, idx) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-start justify-between gap-3"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-white font-mono">
                                  {pat.name}
                                </span>
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded font-mono ${
                                    pat.direction === "bullish"
                                      ? "bg-green-500/20 text-green-400"
                                      : pat.direction === "bearish"
                                      ? "bg-red-500/20 text-red-400"
                                      : "bg-slate-700 text-slate-300"
                                  }`}
                                >
                                  {pat.direction.toUpperCase()}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                                {pat.description}
                              </p>
                            </div>
                            <span className="text-xs font-bold font-mono text-cyan-400 bg-cyan-950/40 px-2 py-1 rounded border border-cyan-800/40">
                              {pat.confidence}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Key Takeaway */}
                    <div className="p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-500/30">
                      <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider block mb-1">
                        Executive Summary
                      </span>
                      <p className="text-xs text-slate-200 leading-relaxed font-sans">
                        {result.keyTakeaway}
                      </p>
                      {result.modelUsed && (
                        <span className="text-[10px] text-slate-500 block mt-2 font-mono">
                          Analyzed with {result.modelUsed}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-full min-h-[300px] rounded-2xl bg-[#0d121f] border border-slate-800 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                    <Zap className="w-10 h-10 text-cyan-400/40 mb-3" />
                    <p className="text-xs text-slate-400">
                      Image loaded. Click <strong>Run Vision AI Analysis</strong> to inspect chart structure.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-[#060910] border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-cyan-400" />
            <span>Encrypted in-memory image processing — never stored on external disk</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
