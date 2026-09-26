import { createClient } from "@supabase/supabase-js";

let browserClient;

export function classifySignUpResult({ user, session } = {}) {
  if (session?.access_token) return { kind: "authenticated" };
  if (user && Array.isArray(user.identities) && user.identities.length === 0) {
    return { kind: "existing-account" };
  }
  return { kind: "confirmation-required" };
}

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;
  const url = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
  const publishableKey = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
  browserClient = url && publishableKey
    ? createClient(url, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
  return browserClient;
}
