import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_NEWS_SOURCES,
  isAllowedNewsUrl,
  normalizeNewsItems,
  refreshAiNews
} from "../src/server/ai-news.js";
import { createAiNewsStore } from "../src/server/ai-news-store.js";

const fetchedAt = "2026-09-25T00:00:00.000Z";

test("normalizes allowlisted HTTPS news newest first and removes duplicates", () => {
  const source = AI_NEWS_SOURCES.find((item) => item.name === "OpenAI");
  const items = normalizeNewsItems({
    source,
    fetchedAt,
    entries: [
      { title: "Older", link: "https://openai.com/news/older", pubDate: "2026-09-20", description: "Older release" },
      { title: "Newest", link: "https://openai.com/news/newest", pubDate: "2026-09-24", description: "Newest release" },
      { title: "Duplicate", link: "https://openai.com/news/newest#top", pubDate: "2026-09-24", description: "Duplicate" },
      { title: "Lookalike", link: "https://openai.com.example.org/news", pubDate: "2026-09-25", description: "Reject" },
      { title: "Insecure", link: "http://openai.com/news/insecure", pubDate: "2026-09-25", description: "Reject" },
      { title: "Bad date", link: "https://openai.com/news/bad-date", pubDate: "not-a-date", description: "Reject" }
    ]
  });

  assert.deepEqual(items.map((item) => item.title), ["Newest", "Older"]);
  assert.equal(items[0].url, "https://openai.com/news/newest");
  assert.equal(isAllowedNewsUrl("https://openai.com/news/ok", source), true);
  assert.equal(isAllowedNewsUrl("https://openai.com.example.org/news/no", source), false);
});

test("local news store persists items and refresh metadata", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ava-ai-news-"));
  const localPath = path.join(directory, "ai-news.json");
  try {
    const store = createAiNewsStore({ localPath });
    await store.initialize();
    await store.replaceSuccessfulSources({
      successfulSources: ["OpenAI"],
      items: [{
        source: "OpenAI",
        title: "Agents API",
        summary: "A new API for agent workflows.",
        recommendation: "Review for service-desk automation.",
        url: "https://openai.com/news/agents-api",
        publishedAt: "2026-09-10T00:00:00.000Z",
        fetchedAt
      }]
    });
    await store.recordRefresh({ status: "success", itemCount: 1, errorMessage: "", startedAt: fetchedAt, finishedAt: fetchedAt });

    const reloaded = createAiNewsStore({ localPath });
    await reloaded.initialize();
    const result = await reloaded.list();
    assert.equal(result.items[0].title, "Agents API");
    assert.equal(result.lastRefresh.status, "success");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("partial refresh publishes successful sources and retains failed source cache", async () => {
  const store = memoryNewsStore([
    newsItem("OpenAI", "Old OpenAI", "https://openai.com/news/old", "2026-09-20"),
    newsItem("Google AI", "Cached Google", "https://blog.google/technology/ai/cached", "2026-09-19")
  ]);
  const sourceXml = rssXml("New OpenAI", "https://openai.com/news/new", "2026-09-24");
  const result = await refreshAiNews({
    sources: [
      { name: "OpenAI", feedUrl: "https://openai.com/news/rss.xml", allowedHostnames: ["openai.com"] },
      { name: "Google AI", feedUrl: "https://blog.google/technology/ai/rss/", allowedHostnames: ["blog.google"] }
    ],
    fetchImpl: async (url) => {
      if (url.includes("openai")) return response(sourceXml);
      throw new Error("Google unavailable");
    },
    store,
    summarize: null,
    now: () => new Date(fetchedAt)
  });

  const cached = await store.list();
  assert.equal(result.status, "partial");
  assert.deepEqual(cached.items.map((item) => item.title), ["New OpenAI", "Cached Google"]);
  assert.match(result.errorMessage, /Google AI/i);
});

test("total refresh failure preserves the previous cache", async () => {
  const store = memoryNewsStore([
    newsItem("OpenAI", "Cached", "https://openai.com/news/cached", "2026-09-20")
  ]);
  const result = await refreshAiNews({
    sources: [{ name: "OpenAI", feedUrl: "https://openai.com/news/rss.xml", allowedHostnames: ["openai.com"] }],
    fetchImpl: async () => { throw new Error("upstream unavailable"); },
    store,
    summarize: null,
    now: () => new Date(fetchedAt)
  });

  assert.equal(result.status, "failed");
  assert.equal((await store.list()).items[0].title, "Cached");
  assert.equal(store.replacements, 0);
});

test("summarizer failure uses deterministic safe text", async () => {
  const store = memoryNewsStore([]);
  await refreshAiNews({
    sources: [{ name: "OpenAI", feedUrl: "https://openai.com/news/rss.xml", allowedHostnames: ["openai.com"] }],
    fetchImpl: async () => response(rssXml("New model", "https://openai.com/news/model", "2026-09-24", "A practical model update for developers.")),
    store,
    summarize: async () => { throw new Error("AI unavailable"); },
    now: () => new Date(fetchedAt)
  });

  const item = (await store.list()).items[0];
  assert.match(item.summary, /practical model update/i);
  assert.match(item.recommendation, /MIS/i);
});

function newsItem(source, title, url, publishedAt) {
  return { source, title, url, publishedAt: new Date(publishedAt).toISOString(), summary: "Summary", recommendation: "Recommendation", fetchedAt };
}

function rssXml(title, link, pubDate, description = "Description") {
  return `<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate><description>${description}</description></item></channel></rss>`;
}

function response(body) {
  return { ok: true, status: 200, text: async () => body };
}

function memoryNewsStore(initialItems) {
  let items = [...initialItems];
  let lastRefresh = null;
  return {
    replacements: 0,
    async list() { return { items: [...items], lastRefresh }; },
    async replaceSuccessfulSources({ successfulSources, items: incoming }) {
      this.replacements += 1;
      items = [...incoming, ...items.filter((item) => !successfulSources.includes(item.source))]
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
        .slice(0, 12);
    },
    async recordRefresh(refresh) { lastRefresh = refresh; }
  };
}
