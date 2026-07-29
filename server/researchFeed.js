const { XMLParser } = require("fast-xml-parser");

const DEFAULT_SOURCES = [
  {
    id: "coindesk",
    name: "CoinDesk",
    tag: "macro",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  },
  {
    id: "cointelegraph",
    name: "Cointelegraph",
    tag: "macro",
    url: "https://cointelegraph.com/rss",
  },
  {
    id: "defillama",
    name: "DefiLlama",
    tag: "defi",
    url: "https://defillama.com/news/rss.xml",
  },
  {
    id: "decrypt",
    name: "Decrypt",
    tag: "regulation",
    url: "https://decrypt.co/feed",
  },
];

const TAG_RULES = [
  {
    tag: "regulation",
    pattern: /\b(sec|cftc|regulat|lawsuit|court|etf|policy|congress|stablecoin|compliance|mifca|mica)\b/i,
  },
  {
    tag: "defi",
    pattern: /\b(defi|dex|dao|staking|yield|lending|aave|uniswap|curve|tvl|liquidity)\b/i,
  },
  {
    tag: "macro",
    pattern: /\b(fed|rates|inflation|macro|dollar|treasury|liquidity|bitcoin|ethereum|market)\b/i,
  },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  trimValues: true,
});

let cache = {
  fetchedAt: 0,
  items: [],
  errors: [],
};

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getNodeText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return value.text || value["#text"] || "";
  return String(value);
}

function getFeedItems(parsed) {
  if (parsed?.rss?.channel?.item) return toArray(parsed.rss.channel.item);
  if (parsed?.feed?.entry) return toArray(parsed.feed.entry);
  return [];
}

function getLink(item) {
  if (typeof item.link === "string") return item.link;
  if (Array.isArray(item.link)) {
    const alternate = item.link.find((link) => link.rel === "alternate") || item.link[0];
    return alternate?.href || alternate?.text || "";
  }
  return item.link?.href || item.link?.text || item.guid?.text || item.guid || "";
}

function inferTag(sourceTag, title, summary) {
  const haystack = `${title} ${summary}`;
  const matched = TAG_RULES.find((rule) => rule.pattern.test(haystack));
  return matched?.tag || sourceTag || "macro";
}

function relativeTimeLabel(publishedAt) {
  const ts = Date.parse(publishedAt);
  if (!Number.isFinite(ts)) return "Date inconnue";
  const minutes = Math.max(0, Math.floor((Date.now() - ts) / 60_000));
  if (minutes < 1) return "A l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "Il y a 1h" : `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Hier" : `Il y a ${days}j`;
}

function parseSources() {
  const raw = process.env.RESEARCH_FEED_SOURCES;
  if (!raw) return DEFAULT_SOURCES;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed
        .map((source, index) => ({
          id: source.id || `source-${index}`,
          name: source.name || source.id || `Source ${index + 1}`,
          tag: source.tag || "macro",
          url: source.url,
        }))
        .filter((source) => source.url);
    }
  } catch {
    return raw
      .split(",")
      .map((url, index) => ({
        id: `source-${index}`,
        name: new URL(url.trim()).hostname.replace(/^www\./, ""),
        tag: "macro",
        url: url.trim(),
      }))
      .filter((source) => source.url);
  }

  return DEFAULT_SOURCES;
}

async function fetchSource(source, limitPerSource) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(source.url, {
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "User-Agent": "CryptoLine research feed",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${source.name} RSS ${response.status}`);
    }

    const xml = await response.text();
    const parsed = parser.parse(xml);
    return getFeedItems(parsed)
      .slice(0, limitPerSource)
      .map((item, index) => {
        const title = stripHtml(getNodeText(item.title));
        const summary = stripHtml(
          getNodeText(item.description) ||
            getNodeText(item.summary) ||
            getNodeText(item["content:encoded"]),
        );
        const publishedAt =
          getNodeText(item.pubDate) ||
          getNodeText(item.published) ||
          getNodeText(item.updated) ||
          new Date().toISOString();
        const link = getLink(item);
        const tag = inferTag(source.tag, title, summary);

        return {
          id: `${source.id}-${Date.parse(publishedAt) || Date.now()}-${index}`,
          source: source.name,
          tag,
          title: title || "Untitled",
          summary: summary || "Aucun resume disponible.",
          url: link,
          time: relativeTimeLabel(publishedAt),
          publishedAt: Date.parse(publishedAt) || Date.now(),
        };
      });
  } finally {
    clearTimeout(timeout);
  }
}

async function getResearchFeed({ tag = "all", limit = 12, force = false } = {}) {
  const cacheTtlMs = Number(process.env.RESEARCH_FEED_CACHE_MS || 5 * 60_000);
  if (!force && Date.now() - cache.fetchedAt < cacheTtlMs && cache.items.length) {
    return {
      items: filterItems(cache.items, tag, limit),
      errors: cache.errors,
      cached: true,
      fetchedAt: new Date(cache.fetchedAt).toISOString(),
    };
  }

  const sources = parseSources();
  const limitPerSource = Number(process.env.RESEARCH_FEED_LIMIT_PER_SOURCE || 6);
  const results = await Promise.allSettled(
    sources.map((source) => fetchSource(source, limitPerSource)),
  );

  const errors = [];
  const items = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value;
    errors.push({
      source: sources[index].name,
      message: result.reason instanceof Error ? result.reason.message : "RSS fetch error",
    });
    return [];
  });

  const sorted = items
    .filter((item) => item.title && item.url)
    .sort((a, b) => b.publishedAt - a.publishedAt);

  cache = {
    fetchedAt: Date.now(),
    items: sorted,
    errors,
  };

  return {
    items: filterItems(sorted, tag, limit),
    errors,
    cached: false,
    fetchedAt: new Date(cache.fetchedAt).toISOString(),
  };
}

function filterItems(items, tag, limit) {
  const filtered = tag && tag !== "all" ? items.filter((item) => item.tag === tag) : items;
  return filtered.slice(0, limit);
}

module.exports = {
  getResearchFeed,
};
