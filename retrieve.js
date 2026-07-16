// retrieve.js
// Step 1 + 2 of the pipeline: domain-scoped search via Serper.dev
// (a Google SERP API), then full-text extraction.

const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { NUM_SOURCES, READ_MORE_TOTAL, WHITELIST_DOMAINS } = require("./config");

/**
 * Run one Serper search and return raw organic results.
 */
async function runSerperQuery(q, num) {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    throw new Error("Missing SERPER_API_KEY in environment");
  }

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q, num }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Serper request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.organic || [];
}

function isWhitelisted(link) {
  try {
    const hostname = new URL(link).hostname.replace(/^www\./, "");
    return WHITELIST_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    );
  } catch {
    return false;
  }
}

function toResultShape(item) {
  return {
    title: item.title,
    link: item.link,
    snippet: item.snippet || "",
  };
}

/**
 * Search restricted to your whitelist.
 *
 * Serper's free/trial tier rejects overly complex query patterns -- a
 * single query with 15+ OR'd site: filters chained together triggers
 * "Query pattern not allowed for free accounts." So instead:
 *
 * 1. Run one plain query (no site: filters at all) -- cheap, always
 *    allowed, and filter the results down to whitelist domains only.
 * 2. If that doesn't yield enough results, fall back to individual
 *    "question site:domain.com" queries per whitelist domain, run in
 *    parallel, and merge/dedupe. This costs more API credits (one call
 *    per domain) but only runs when the plain search comes up short.
 *
 * Returns [{ title, link, snippet }]
 */
// A simple helper to split our big list of websites into small groups
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function searchWhitelist(query) {
  // 1. Try a normal search first
  const plainResults = await runSerperQuery(query, READ_MORE_TOTAL);
  const filtered = plainResults.filter((r) => isWhitelisted(r.link));

  // If we found enough trusted links right away, just use them!
  if (filtered.length >= NUM_SOURCES) {
    return filtered.map(toResultShape);
  }

  // 2. If not, search our whitelisted sites in small groups of 5
  const domainChunks = chunkArray(WHITELIST_DOMAINS, 5);
  const batchPromises = domainChunks.map(async (chunk) => {
    try {
      // This creates a search query like: "global warming site:nasa.gov OR site:noaa.gov"
      const siteFilter = chunk.map(domain => `site:${domain}`).join(" OR ");
      const combinedQuery = `${query} (${siteFilter})`;
      
      const results = await runSerperQuery(combinedQuery, 3);
      return results.filter((r) => isWhitelisted(r.link));
    } catch (err) {
      return []; // If one group fails, keep going quietly
    }
  });

  const batchResults = (await Promise.all(batchPromises)).flat();

  // Combine, remove duplicates, and return the top links
  const merged = [...filtered, ...batchResults];
  const seen = new Set();
  const deduped = merged.filter((r) => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });

  return deduped.slice(0, READ_MORE_TOTAL).map(toResultShape);
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
 * Full retrieval step: search, then split results into two groups --
 * the first NUM_SOURCES get full-text extraction (for the AI to read),
 * the remaining ones (up to READ_MORE_TOTAL) stay as lightweight
 * title/link/snippet only, for the "read more" expansion in the UI.
 *
 * Returns { aiSources: [{index,title,link,text}], moreSources: [{title,link,snippet}] }
 */
async function retrieveSources(query) {
  const results = await searchWhitelist(query);

  if (!results || results.length === 0) {
    return { aiSources: [], moreSources: [] };
  }

  const forAI = results.slice(0, NUM_SOURCES);
  const extras = results.slice(NUM_SOURCES);

  console.log(
    `  [Scraper] Extracting full text for ${forAI.length} AI source(s), ${extras.length} extra link(s) held for "read more"...`
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

module.exports = { searchWhitelist, extractArticleText, retrieveSources, isWhitelisted };
