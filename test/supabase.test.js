import test from "node:test";
import assert from "node:assert/strict";

import {
  createSupabaseRestClient,
  getSupabaseConfig,
  isSupabaseConfigured
} from "../src/server/supabase-store.js";

test("Supabase config stays disabled until URL and service role key are configured", () => {
  assert.equal(isSupabaseConfigured({}), false);
  assert.equal(isSupabaseConfigured({ SUPABASE_URL: "https://example.supabase.co" }), false);
  assert.equal(
    isSupabaseConfigured({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    }),
    true
  );
});

test("Supabase config normalizes the REST endpoint and default bucket", () => {
  const config = getSupabaseConfig({
    SUPABASE_URL: "https://example.supabase.co/",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  });

  assert.equal(config.url, "https://example.supabase.co");
  assert.equal(config.bucket, "helpdesk-pdfs");
});

test("Supabase REST client writes sessions with upsert semantics", async () => {
  const calls = [];
  const client = createSupabaseRestClient({
    config: {
      url: "https://example.supabase.co",
      key: "service-role",
      bucket: "helpdesk-pdfs"
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => []
      };
    }
  });

  await client.saveSession("tab-a", [{ role: "user", content: "hello" }]);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/ava_sessions/);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Prefer, "resolution=merge-duplicates");
  assert.match(calls[0].options.body, /tab-a/);
});
