import { createClient } from "@supabase/supabase-js";

const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : ({} as Record<string, string>);
const url = (env.VITE_SUPABASE_URL as string | undefined) || "https://dummyproject.supabase.co";
const anonKey = (env.VITE_SUPABASE_ANON_KEY as string | undefined) || "dummy-anon-key";

export const supabase = createClient(url, anonKey);
