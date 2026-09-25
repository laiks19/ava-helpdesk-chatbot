import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/rest\/v1\/?$/, "");
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });
}
