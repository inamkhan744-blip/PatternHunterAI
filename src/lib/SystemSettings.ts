import { supabase } from "./supabase";

/**
 * Platform-wide flags owned by the Super Admin Panel and stored on the
 * `global_settings` singleton row (`id = 'global_config'`).
 *
 * Read access: every authenticated user (RLS `authenticated_read_global_settings`).
 * Write access: admins only (`admin_insert_global_settings` / `admin_update_global_settings`).
 */
export interface SystemSettings {
  maintenanceMode: boolean;
  broadcastMessage: string;
  enableVisionAI: boolean;
  enableAutopilot: boolean;
  enableTelegram: boolean;
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  maintenanceMode: false,
  broadcastMessage: "",
  enableVisionAI: true,
  enableAutopilot: true,
  enableTelegram: true,
};

const GLOBAL_SETTINGS_ID = "global_config";
const CACHE_TTL_MS = 60_000;

let cached: SystemSettings | null = null;
let cachedAt = 0;

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "off") return false;
  }
  return fallback;
}

function rowToSettings(row: Record<string, unknown>): SystemSettings {
  return {
    maintenanceMode: readBoolean(row.maintenance_mode, false),
    broadcastMessage:
      typeof row.broadcast_message === "string" ? row.broadcast_message.slice(0, 500) : "",
    // Feature flags fail OPEN: a deployment that has not run the migration yet must
    // keep every feature visible rather than silently hiding it.
    enableVisionAI: readBoolean(row.enable_vision_ai, true),
    enableAutopilot: readBoolean(row.enable_autopilot, true),
    enableTelegram: readBoolean(row.enable_telegram, true),
  };
}

/** Reads the global settings row. Never throws: a read failure keeps the last value. */
export async function fetchSystemSettings(force = false): Promise<SystemSettings> {
  if (!force && cached && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const { data, error } = await supabase
      .from("global_settings")
      .select("*")
      .eq("id", GLOBAL_SETTINGS_ID)
      .maybeSingle();

    if (error || !data) {
      if (error) console.warn("[SystemSettings] read failed:", error.message);
      return cached ?? { ...DEFAULT_SYSTEM_SETTINGS };
    }

    cached = rowToSettings(data as Record<string, unknown>);
    cachedAt = Date.now();
    return cached;
  } catch (err) {
    console.warn("[SystemSettings] read failed:", err instanceof Error ? err.message : err);
    return cached ?? { ...DEFAULT_SYSTEM_SETTINGS };
  }
}

export function invalidateSystemSettingsCache(): void {
  cached = null;
  cachedAt = 0;
}

/**
 * Persists a partial settings change. Only the five managed columns are sent, so a
 * concurrent AI-vault save cannot be clobbered by this write.
 */
export async function saveSystemSettings(
  patch: Partial<SystemSettings>
): Promise<SystemSettings> {
  const current = await fetchSystemSettings(true);
  const next: SystemSettings = { ...current, ...patch };

  const { data, error } = await supabase
    .from("global_settings")
    .upsert(
      {
        id: GLOBAL_SETTINGS_ID,
        maintenance_mode: next.maintenanceMode,
        broadcast_message: next.broadcastMessage.trim(),
        enable_vision_ai: next.enableVisionAI,
        enable_autopilot: next.enableAutopilot,
        enable_telegram: next.enableTelegram,
      },
      { onConflict: "id" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not save system settings: ${error.message}`);
  }

  cached = data ? rowToSettings(data as Record<string, unknown>) : next;
  cachedAt = Date.now();
  return cached;
}
