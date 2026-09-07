import test from "node:test";
import assert from "node:assert/strict";

import {
  createSupabaseRestClient,
  getSupabaseConfig,
  isSupabaseConfigured,
  loadSupabaseDocumentsSafely,
  getSupabaseSessionSafely,
  saveSupabaseSessionSafely
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

test("Supabase config accepts a copied REST endpoint URL", () => {
  const config = getSupabaseConfig({
    SUPABASE_URL: "https://example.supabase.co/rest/v1/",
    SUPABASE_SERVICE_ROLE_KEY: "service-role"
  });

  assert.equal(config.url, "https://example.supabase.co");
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

test("Supabase REST client accepts successful empty JSON responses", async () => {
  const client = createSupabaseRestClient({
    config: {
      url: "https://example.supabase.co",
      key: "service-role",
      bucket: "helpdesk-pdfs"
    },
    fetchImpl: async () => ({
      ok: true,
      status: 201,
      text: async () => "  \n"
    })
  });

  await assert.doesNotReject(() => client.saveSession("tab-a", [{ role: "user", content: "hello" }]));
});

test("Supabase document startup failures fall back to an empty library", async () => {
  const documents = await loadSupabaseDocumentsSafely({
    loadDocuments: async () => {
      throw new Error("fetch failed");
    }
  });

  assert.deepEqual(documents, []);
});

test("Supabase session persistence failures do not block chat replies", async () => {
  const client = {
    getSession: async () => {
      throw new Error("Unexpected end of JSON input");
    },
    saveSession: async () => {
      throw new Error("Unexpected end of JSON input");
    }
  };

  assert.deepEqual(await getSupabaseSessionSafely(client, "tab-a"), []);
  await assert.doesNotReject(() => saveSupabaseSessionSafely(client, "tab-a", []));
});
