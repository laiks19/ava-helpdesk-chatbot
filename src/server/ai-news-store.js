import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const emptyState = { items: [], lastRefresh: null };

export function createAiNewsStore({ supabase = null, localPath = "", isProduction = false } = {}) {
  if (isProduction && !supabase) throw new Error("Supabase is required for production AI news.");
  return supabase ? createSupabaseNewsStore(supabase) : createLocalNewsStore(localPath);
}

function createLocalNewsStore(localPath) {
  let state = structuredClone(emptyState);

  async function initialize() {
    try {
      state = normalizeState(JSON.parse(await readFile(localPath, "utf8")));
    } catch {
      state = structuredClone(emptyState);
      if (localPath) await persist();
    }
    return api;
  }

  async function list() {
    return structuredClone(state);
  }

  async function replaceSuccessfulSources({ successfulSources = [], items = [] }) {
    state.items = [...items, ...state.items.filter((item) => !successfulSources.includes(item.source))]
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 12);
    await persist();
  }

  async function recordRefresh(refresh) {
    state.lastRefresh = { ...refresh };
    await persist();
  }

  async function persist() {
    if (!localPath) return;
    await mkdir(path.dirname(localPath), { recursive: true });
    const tempPath = `${localPath}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, localPath);
  }

  const api = { initialize, list, replaceSuccessfulSources, recordRefresh };
  return api;
}

function createSupabaseNewsStore(supabase) {
  async function initialize() {
    return api;
  }

  async function list() {
    const [{ data: items, error: itemError }, { data: refresh, error: refreshError }] = await Promise.all([
      supabase.from("ai_news_items").select("*").order("published_at", { ascending: false }).limit(12),
      supabase.from("ai_news_refreshes").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    if (itemError) throw itemError;
    if (refreshError) throw refreshError;
    return { items: (items || []).map(normalizeItem), lastRefresh: refresh ? normalizeRefresh(refresh) : null };
  }

  async function replaceSuccessfulSources({ successfulSources = [], items = [] }) {
    if (items.length) {
      const { error } = await supabase.from("ai_news_items").upsert(items.map(itemToRow), { onConflict: "url" });
      if (error) throw error;
    }
    for (const source of successfulSources) {
      const keepUrls = items.filter((item) => item.source === source).map((item) => item.url);
      let query = supabase.from("ai_news_items").delete().eq("source", source);
      if (keepUrls.length) query = query.not("url", "in", `(${keepUrls.map(quotePostgrest).join(",")})`);
      const { error } = await query;
      if (error) throw error;
    }
    const { data: all, error: listError } = await supabase.from("ai_news_items").select("id").order("published_at", { ascending: false });
    if (listError) throw listError;
    const excess = (all || []).slice(12).map((row) => row.id);
    if (excess.length) {
      const { error } = await supabase.from("ai_news_items").delete().in("id", excess);
      if (error) throw error;
    }
  }

  async function recordRefresh(refresh) {
    const { error } = await supabase.from("ai_news_refreshes").insert(refreshToRow(refresh));
    if (error) throw error;
  }

  const api = { initialize, list, replaceSuccessfulSources, recordRefresh };
  return api;
}

function normalizeState(value) {
  return {
    items: Array.isArray(value?.items) ? value.items.slice(0, 12) : [],
    lastRefresh: value?.lastRefresh || null
  };
}

function itemToRow(item) {
  return {
    id: item.id || randomUUID(),
    source: item.source,
    title: item.title,
    summary: item.summary,
    recommendation: item.recommendation,
    url: item.url,
    published_at: item.publishedAt,
    fetched_at: item.fetchedAt
  };
}

function normalizeItem(row) {
  return { id: row.id, source: row.source, title: row.title, summary: row.summary, recommendation: row.recommendation, url: row.url, publishedAt: row.published_at, fetchedAt: row.fetched_at };
}

function refreshToRow(refresh) {
  return { status: refresh.status, item_count: refresh.itemCount, error_message: refresh.errorMessage, started_at: refresh.startedAt, finished_at: refresh.finishedAt };
}

function normalizeRefresh(row) {
  return { status: row.status, itemCount: row.item_count, errorMessage: row.error_message, startedAt: row.started_at, finishedAt: row.finished_at };
}

function quotePostgrest(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}
