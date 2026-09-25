import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSupabaseRestClient,
  getSupabaseConfig,
  isSupabaseConfigured,
  loadSupabaseDocumentsSafely,
  getSupabaseSessionSafely,
  saveSupabaseSessionSafely
} from "../src/server/supabase-store.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("Supabase client deletes PDFs from storage and document table", async () => {
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
        status: 204,
        text: async () => ""
      };
    }
  });

  await client.deletePdf({
    id: "doc-1",
    storedName: "folder/printer guide.pdf"
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "DELETE");
  assert.match(calls[0].url, /\/storage\/v1\/object\/helpdesk-pdfs\/folder%2Fprinter%20guide\.pdf/);
  assert.equal(calls[1].options.method, "DELETE");
  assert.match(calls[1].url, /\/rest\/v1\/ava_documents\?id=eq\.doc-1/);
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

test("helpdesk migration creates protected account and ticket tables", async () => {
  const migrationsDir = path.join(projectRoot, "supabase", "migrations");
  assert.equal(existsSync(migrationsDir), true, "Supabase migrations directory is missing");
  const migrationName = (await readdir(migrationsDir)).find((name) =>
    name.endsWith("_helpdesk_accounts_and_ticketing.sql")
  );
  assert.ok(migrationName, "helpdesk account migration is missing");
  const sql = await readFile(path.join(migrationsDir, migrationName), "utf8");

  for (const table of ["profiles", "technicians", "tickets", "ticket_activity"]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }

  assert.match(sql, /approval_status/i);
  assert.match(sql, /must_change_password/i);
  assert.match(sql, /assigned_technician_id/i);
  assert.match(sql, /deleted_at/i);
  assert.match(sql, /create index/i);
  assert.match(sql, /revoke all/i);
});

test("ordered Supabase migrations include Ava persistence and private PDF storage", async () => {
  const migrationsDir = path.join(projectRoot, "supabase", "migrations");
  const migrationNames = (await readdir(migrationsDir)).sort();
  const coreName = migrationNames.find((name) => name.endsWith("_ava_core.sql"));
  const helpdeskName = migrationNames.find((name) => name.endsWith("_helpdesk_accounts_and_ticketing.sql"));
  assert.ok(coreName);
  assert.ok(helpdeskName);
  assert.ok(coreName < helpdeskName, "Ava core migration must run before helpdesk accounts");
  const sql = await readFile(path.join(migrationsDir, coreName), "utf8");
  for (const table of ["ava_documents", "ava_sessions", "ava_conversation_logs"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(sql, /helpdesk-pdfs/);
  assert.match(sql, /public\s*=\s*false/i);
});

test("AI news migration protects cached items and refresh history", async () => {
  const migrationsDir = path.join(projectRoot, "supabase", "migrations");
  const migrationName = (await readdir(migrationsDir)).find((name) => name.endsWith("_daily_ai_news.sql"));
  assert.ok(migrationName, "daily AI news migration is missing");
  const sql = await readFile(path.join(migrationsDir, migrationName), "utf8");
  for (const table of ["ai_news_items", "ai_news_refreshes"]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"));
  }
  assert.match(sql, /url text not null unique/i);
  assert.match(sql, /status in \('success', 'partial', 'failed'\)/i);
  assert.match(sql, /grant all on table public\.ai_news_items to service_role/i);
  assert.match(sql, /create index/i);
});

test("browser Supabase client uses only publishable environment values", async () => {
  const clientPath = path.join(projectRoot, "src", "client", "supabase-client.js");
  assert.equal(existsSync(clientPath), true, "browser Supabase client is missing");
  const source = await readFile(clientPath, "utf8");

  assert.match(source, /VITE_SUPABASE_URL/);
  assert.match(source, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(source, /SERVICE_ROLE/);
});

test("server Supabase admin and bootstrap keep privileged keys server-side", async () => {
  const adminPath = path.join(projectRoot, "src", "server", "supabase-admin.js");
  const bootstrapPath = path.join(projectRoot, "scripts", "bootstrap-admin.js");
  assert.equal(existsSync(adminPath), true, "server Supabase admin client is missing");
  assert.equal(existsSync(bootstrapPath), true, "administrator bootstrap script is missing");
  const [adminSource, bootstrapSource] = await Promise.all([
    readFile(adminPath, "utf8"),
    readFile(bootstrapPath, "utf8")
  ]);

  assert.match(adminSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(bootstrapSource, /kokseng\.lai@ecoworld\.my/);
  assert.match(bootstrapSource, /admin123/);
  assert.match(bootstrapSource, /must_change_password/);
  assert.doesNotMatch(bootstrapSource, /console\.log\([^)]*admin123/);
});
