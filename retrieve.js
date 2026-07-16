// retrieve.js
// Step 1 + 2 of the pipeline: domain-scoped search via Serper.dev
// (a Google SERP API), then full-text extraction.

const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { NUM_SOURCES, WHITELIST_DOMAINS } = require("./config");

/**
 * Serper wraps real Google search results, so standard Google search
 * operators work -- including OR'd site: filters.
 */
function buildWhitelistQuery(query) {
  const siteFilters = WHITELIST_DOMAINS.map((d) => `site:${d}`).join(" OR ");
  return `${query} (${siteFilters})`;
}

/**
 * Search via Serper.dev, restricted to whitelist domains.
 * Returns [{ title, link, snippet }]
 */
async function searchWhitelist(query) {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    throw new Error("Missing SERPER_API_KEY in environment");
  }

  const fullQuery = buildWhitelistQuery(query);

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: fullQuery,
      num: NUM_SOURCES,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Serper request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const results = data.organic || [];

  if (results.length === 0) {
    return [];
  }

  // Belt-and-suspenders: verify each result's hostname is actually on our
  // whitelist before trusting it -- OR'd site: filters can occasionally
  // let unrelated results slip through.
  const filtered = results.filter((r) => {
    try {
      const hostname = new URL(r.link).hostname.replace(/^www\./, "");
      return WHITELIST_DOMAINS.some(
        (d) => hostname === d || hostname.endsWith(`.${d}`)
      );
    } catch {
      return false;
    }
  });

  return filtered.map((item) => ({
    title: item.title,
    link: item.link,
    snippet: item.snippet || "",
  }));
}

/**
 * Fetch a URL and extract clean article text (strips nav/ads/boilerplate).
 * Falls back to the search snippet if extraction fails -- some gov/science
 * sites block scraping or have unusual markup.
 */
async function extractArticleText(url, fallbackSnippet) {
  try {
    // Create an AbortController to strictly enforce a fast 3-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); 

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VeritasBot/0.1)" },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId); // Clear timeout if it fetched in time

    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < 200) {
      throw new Error("extraction too short / failed");
    }

    return article.textContent.trim().slice(0, 4000); // Shorter slice speeds up LLM processing too!
  } catch (err) {
    console.warn(`  [extract fallback] ${url} -> ${err.name === 'AbortError' ? 'Timeout' : err.message}`);
    return fallbackSnippet || "";
  }
}

/**
 * Full retrieval step: search + extract for every result IN PARALLEL.
 * Returns [{ index, title, link, text }]
 */
async function retrieveSources(query) {
  const results = await searchWhitelist(query);

  if (!results || results.length === 0) {
    return [];
  }

  console.log(`  [Scraper] Launching parallel extraction for ${results.length} sources...`);

  // Fire off all scraping/extraction requests simultaneously!
  const scrapePromises = results.map(async (r) => {
    const text = await extractArticleText(r.link, r.snippet);
    return {
      index: r.index,
      title: r.title,
      link: r.link,
      text: text,
    };
  });

  // Wait for all of them to resolve (or fail gracefully with their fallbacks)
  const sources = await Promise.all(scrapePromises);

  return sources;
}

module.exports = { searchWhitelist, extractArticleText, retrieveSources };
