/**
 * ModelManager: Handles dynamic Gemini models listing, testing, and persistence.
 */

export const STORAGE_KEY_GEMINI_KEY = "fortress_gemini_api_key";
export const STORAGE_KEY_GEMINI_MODEL = "fortress_gemini_selected_model";
export const STORAGE_KEY_GEMINI_MODELS_CACHE = "fortress_gemini_models_cache";

export const DEFAULT_FALLBACK_MODELS = [
  "gemini-2.0-flash",
  "gemini-1.5-flash",
  "gemini-2.0-flash-001",
  "gemini-1.5-pro",
];

export interface GeminiModelInfo {
  name: string; // e.g. "models/gemini-2.0-flash"
  version?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

/**
 * Extracts normalized model ID from full name e.g. "models/gemini-2.0-flash" -> "gemini-2.0-flash"
 */
export function normalizeModelName(rawName: string): string {
  if (!rawName) return "";
  return rawName.startsWith("models/") ? rawName.slice(7) : rawName;
}

/**
 * Retrieves the stored Gemini API key from localStorage or env fallback.
 */
export function getGeminiApiKey(): string {
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_GEMINI_KEY);
      if (stored && stored.trim()) {
        return stored.trim();
      }
    } catch {
      // fallback
    }
  }
  let envKey: string | undefined;
  try {
    if (typeof import.meta !== "undefined" && import.meta.env) {
      envKey = import.meta.env.VITE_GEMINI_API_KEY;
    }
  } catch {
    // ignore
  }
  return envKey?.trim() || "";
}

/**
 * Stores the Gemini API key into localStorage.
 */
export function setGeminiApiKey(apiKey: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_GEMINI_KEY, apiKey.trim());
  } catch (err) {
    console.error("Failed to store Gemini API key:", err);
  }
}

/**
 * Retrieves the selected Gemini model name from localStorage.
 */
export function getSelectedModel(): string {
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_GEMINI_MODEL);
      if (stored && stored.trim()) {
        return stored.trim();
      }
    } catch {
      // fallback
    }
  }
  return DEFAULT_FALLBACK_MODELS[0];
}

/**
 * Stores the selected Gemini model into localStorage.
 */
export function setSelectedModel(modelName: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_GEMINI_MODEL, normalizeModelName(modelName));
  } catch (err) {
    console.error("Failed to store selected Gemini model:", err);
  }
}

/**
 * Retrieves cached list of available models from localStorage.
 */
export function getCachedModels(): string[] {
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_GEMINI_MODELS_CACHE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // fallback
    }
  }
  return DEFAULT_FALLBACK_MODELS;
}

/**
 * Stores cached list of available models into localStorage.
 */
export function setCachedModels(models: string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY_GEMINI_MODELS_CACHE, JSON.stringify(models));
  } catch (err) {
    console.error("Failed to cache models list:", err);
  }
}

/**
 * Fetches available Gemini models supporting generateContent from Google API.
 * Calls https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}
 */
export async function fetchAvailableModels(apiKey: string): Promise<string[]> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    throw new Error("API Key is required to fetch models.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmedKey)}`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();

  if (!res.ok) {
    const errorMsg = data?.error?.message || `HTTP ${res.status}: ${res.statusText}`;
    throw new Error(errorMsg);
  }

  const modelsList: GeminiModelInfo[] = data?.models || [];
  // Filter to only include models supporting generateContent
  const contentModels = modelsList
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => normalizeModelName(m.name))
    .filter(Boolean);

  if (contentModels.length === 0) {
    // If none explicitly matched, take any models returned or fallback
    const allModels = modelsList.map((m) => normalizeModelName(m.name)).filter(Boolean);
    const result = allModels.length > 0 ? allModels : DEFAULT_FALLBACK_MODELS;
    setCachedModels(result);
    return result;
  }

  // Remove duplicates
  const uniqueModels = Array.from(new Set(contentModels));
  setCachedModels(uniqueModels);
  return uniqueModels;
}

/**
 * Tests a model by sending a tiny prompt ("Say OK").
 * Returns { success: boolean, message: string }.
 */
export async function testModel(
  apiKey: string,
  modelName: string
): Promise<{ success: boolean; message: string }> {
  const trimmedKey = apiKey.trim();
  const normalizedModel = normalizeModelName(modelName);

  if (!trimmedKey) {
    return { success: false, message: "API Key Invalid: Key is empty." };
  }
  if (!normalizedModel) {
    return { success: false, message: "No model selected." };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(trimmedKey)}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: "Say OK" }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 10,
          temperature: 0.1,
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      const errorMsg = data?.error?.message || `Error ${res.status}: ${res.statusText}`;
      return { success: false, message: errorMsg };
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (reply !== undefined) {
      return { success: true, message: "Model is working!" };
    }

    return { success: false, message: "Received empty candidate response from model." };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Network error contacting Gemini API",
    };
  }
}
