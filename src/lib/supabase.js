import { createClient } from "@supabase/supabase-js";

function normalizeEnvValue(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  // Handles accidental "placeholder real_value" entries in .env.
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1];
}

const supabaseUrl = normalizeEnvValue(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = normalizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY);

export const isSupabaseConfigured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  typeof supabaseUrl === "string" &&
  supabaseUrl.startsWith("http");

export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;
