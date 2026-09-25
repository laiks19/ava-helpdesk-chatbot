import { XMLParser } from "fast-xml-parser";

export const AI_NEWS_SOURCES = Object.freeze([
  Object.freeze({
    name: "OpenAI",
    feedUrl: "https://openai.com/news/rss.xml",
    allowedHostnames: ["openai.com", "www.openai.com"]
  }),
  Object.freeze({
    name: "Google AI",
    feedUrl: "https://blog.google/technology/ai/rss/",
    allowedHostnames: ["blog.google"]
  }),
  Object.freeze({
    name: "Anthropic",
    feedUrl: "https://www.anthropic.com/rss.xml",
    allowedHostnames: ["anthropic.com", "www.anthropic.com"]
  })
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  processEntities: false
});

export function isAllowedNewsUrl(value, source) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && source.allowedHostnames.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function parseNewsFeed(xml) {
  const parsed = parser.parse(String(xml || ""));
  const rssItems = parsed?.rss?.channel?.item;
  const atomItems = parsed?.feed?.entry;
  return toArray(rssItems || atomItems).map((entry) => ({
    title: textValue(entry.title),
    link: linkValue(entry.link),
    pubDate: textValue(entry.pubDate || entry.published || entry.updated),
    description: stripMarkup(textValue(entry.description || entry.summary || entry.content))
  }));
}

export function normalizeNewsItems({ source, entries = [], fetchedAt = new Date().toISOString() }) {
  const seen = new Set();
  return entries.flatMap((entry) => {
    const title = cleanText(entry.title, 220);
    const canonicalUrl = canonicalizeUrl(entry.link);
    const publishedAt = validDate(entry.pubDate);
    if (!title || !canonicalUrl || !publishedAt || !isAllowedNewsUrl(canonicalUrl, source) || seen.has(canonicalUrl)) return [];
    seen.add(canonicalUrl);
    const description = cleanText(stripMarkup(entry.description), 520);
    return [{
      source: source.name,
      title,
      summary: description || `${source.name} published a new artificial intelligence update.`,
      recommendation: defaultRecommendation(source.name),
      url: canonicalUrl,
      publishedAt,
      fetchedAt
    }];
  }).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

export async function refreshAiNews({
  sources = AI_NEWS_SOURCES,
  fetchImpl = fetch,
  store,
  summarize = null,
  now = () => new Date()
}) {
  const startedAt = now().toISOString();
  const fetchedAt = startedAt;
  const successfulSources = [];
  const sourceResults = [];
  const collected = [];

  for (const source of sources) {
    try {
      const response = await fetchImpl(source.feedUrl, {
        headers: { "User-Agent": "Ava-HelpDesk-AI-News/1.0" },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const entries = parseNewsFeed(await response.text());
      const items = normalizeNewsItems({ source, entries, fetchedAt });
      if (!items.length) throw new Error("No valid articles found");
      successfulSources.push(source.name);
      collected.push(...items);
      sourceResults.push({ source: source.name, status: "success", itemCount: items.length });
    } catch (error) {
      sourceResults.push({ source: source.name, status: "failed", itemCount: 0, error: sanitizeError(error) });
    }
  }

  let items = deduplicateNews(collected).slice(0, 12);
  if (items.length && summarize) {
    items = await Promise.all(items.map(async (item) => {
      try {
        const result = await summarize({ ...item });
        return {
          ...item,
          summary: cleanText(result?.summary, 520) || item.summary,
          recommendation: cleanText(result?.recommendation, 240) || item.recommendation
        };
      } catch {
        return item;
      }
    }));
  }

  const failedSources = sourceResults.filter((result) => result.status === "failed");
  const status = !successfulSources.length ? "failed" : failedSources.length ? "partial" : "success";
  if (successfulSources.length) {
    await store.replaceSuccessfulSources({ successfulSources, items });
  }
  const finishedAt = now().toISOString();
  const errorMessage = failedSources.map((result) => `${result.source}: ${result.error}`).join("; ").slice(0, 1000);
  const cached = await store.list();
  const refresh = { status, itemCount: cached.items.length, errorMessage, startedAt, finishedAt };
  await store.recordRefresh(refresh);
  return { ...refresh, sourceResults };
}

function canonicalizeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|trk$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function validDate(value) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function textValue(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value?.["#text"] || value?.__cdata || "");
}

function linkValue(value) {
  if (Array.isArray(value)) {
    const alternate = value.find((entry) => !entry?.["@_rel"] || entry["@_rel"] === "alternate");
    return linkValue(alternate || value[0]);
  }
  if (typeof value === "string") return value;
  return String(value?.["@_href"] || value?.["#text"] || "");
}

function stripMarkup(value = "") {
  return String(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&");
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function defaultRecommendation(source) {
  return `MIS recommendation: review this ${source} update for potential security, productivity, or support-service impact.`;
}

function deduplicateNews(items) {
  const seen = new Set();
  return [...items]
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .filter((item) => !seen.has(item.url) && seen.add(item.url));
}

function sanitizeError(error) {
  return cleanText(error?.message || "Source unavailable", 180).replace(/https?:\/\/\S+/gi, "source URL");
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
