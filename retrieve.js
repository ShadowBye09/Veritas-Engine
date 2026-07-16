// retrieve.js
// Step 1 + 2 of the pipeline: Standard search via Serper.dev,
// then filtering and full-text extraction.

const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { NUM_SOURCES, READ_MORE_TOTAL, WHITELIST_DOMAINS } = require("./config");

/**
 * Search via Serper.dev, using standard queries to keep free tier active.
 * Returns [{ title, link, snippet }]
 */
async function searchWhitelist(query) {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    throw new Error("Missing SERPER_API_KEY in environment");
  }

  // To bypass free-tier restrictions, we search standardly but request
  // up to 40 results so we can filter down to our whitelist domains locally.
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: 40, // Pull a broader set to ensure we capture whitelisted domains
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

  // Filter results locally to ONLY allow Whitelist Domains
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
 * Falls back to the search snippet if extraction fails.
 */
async function extractArticleText(url, fallbackSnippet) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); 

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VeritasBot/0.1)" },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < 200) {
      throw new Error("extraction too short / failed");
    }

    return article.textContent.trim().slice(0, 4000); 
  } catch (err) {
    console.warn(`  [extract fallback] ${url} -> ${err.name === 'AbortError' ? 'Timeout' : err.message}`);
    return fallbackSnippet || "";
  }
}

/**
 * Full retrieval step: search, filter, then split results.
 * Top results are extracted for AI context, and the rest serve as raw links.
 */
async function retrieveSources(query) {
  const results = await searchWhitelist(query);

  if (!results || results.length === 0) {
    return { aiSources: [], moreSources: [] };
  }

  // Grab top 5 for the AI context, next 10 for the "Read More" list
  const forAI = results.slice(0, NUM_SOURCES);
  const extras = results.slice(NUM_SOURCES, NUM_SOURCES + READ_MORE_TOTAL);

  console.log(
    `  [Scraper] Extracting full text for ${forAI.length} AI source(s), keeping ${extras.length} extra link(s) for "read more"...`
  );

  const scrapePromises = forAI.map(async (r, i) => {
    const text = await extractArticleText(r.link, r.snippet);
    return {
      index: i + 1,
      title: r.title,
      link: r.link,
      text,
    };
  });

  const aiSources = await Promise.all(scrapePromises);

  const moreSources = extras.map((r) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
  }));

  return { aiSources, moreSources };
}

module.exports = { searchWhitelist, extractArticleText, retrieveSources };
