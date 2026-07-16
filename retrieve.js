// retrieve.js
// Step 1 + 2 of the pipeline: domain-scoped search via Serper.dev
// (a Google SERP API), optional de-biasing query splitting, then full-text extraction.

const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const OpenAI = require("openai");
const { NUM_SOURCES, READ_MORE_TOTAL, WHITELIST_DOMAINS } = require("./config");

// Initialize OpenAI client (automatically uses process.env.OPENAI_API_KEY)
const openai = new OpenAI();

const CONTESTED_KEYWORDS = [
  "god", "trinity", "jesus god", "free will", "creationism",
  "afterlife", "existential", "string theory", "abortion", "capitalism"
];

function isContestedQuery(query) {
  const normalized = query.toLowerCase();
  return CONTESTED_KEYWORDS.some(keyword => normalized.includes(keyword));
}

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
 * Strips bias from a user's question and creates two structurally 
 * balanced search queries representing different sides of the coin.
 */
async function generateDeBiasedQueries(rawQuestion) {
  const systemPrompt = `You are a query de-biasing assistant. 
Your task is to take a user's question (which may be loaded with bias, poorly phrased, or leading) and break it down into TWO neutral, highly optimized search queries for academic search engines.
- Query A: Formulated to find evidence, arguments, or perspectives supporting the main premise.
- Query B: Formulated to find counterarguments, criticisms, or skeptical perspectives opposing the main premise.
- Keep them academic, direct, and stripped of emotional language.

Respond ONLY with a valid JSON object of this exact shape:
{
  "query_supporting": "neutral academic search query for Side A",
  "query_opposing": "neutral academic search query for Side B"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `De-bias this question: "${rawQuestion}"` }
      ]
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return parsed;
  } catch (error) {
    console.warn("Failed to de-bias query, falling back to original:", error.message);
    return { query_supporting: rawQuestion, query_opposing: rawQuestion };
  }
}

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
 * Full retrieval step with optional de-biased partitioning.
 */
async function retrieveSources(query, mode, debias = false) {
  let results = [];

  // Determine if we should perform De-Biased query splitting
  if (debias || mode === "contested" || isContestedQuery(query)) {
    console.log(`[Retrieve] Activating Multi-Perspective Query Split...`);
    
    // De-bias the query using our helper
    const { query_supporting, query_opposing } = await generateDeBiasedQueries(query);
    console.log(`  -> Supporting Search: "${query_supporting}"`);
    console.log(`  -> Opposing Search: "${query_opposing}"`);

    // Fetch both in parallel
    const [resultsA, resultsB] = await Promise.all([
      searchWhitelist(query_supporting),
      searchWhitelist(query_opposing)
    ]);

    // Interleave the results (take up to 3 from each side) to guarantee balance
    const combined = [];
    const maxLen = Math.max(resultsA.length, resultsB.length);
    for (let i = 0; i < maxLen; i++) {
      if (resultsA[i]) combined.push(resultsA[i]);
      if (resultsB[i]) combined.push(resultsB[i]);
    }

    // Deduplicate in case any link appeared on both sides
    const seen = new Set();
    results = combined.filter((r) => {
      if (seen.has(r.link)) return false;
      seen.add(r.link);
      return true;
    });
  } else {
    // Normal single-sided search
    results = await searchWhitelist(query);
  }

  if (!results || results.length === 0) {
    return { aiSources: [], moreSources: [] };
  }

  const forAI = results.slice(0, NUM_SOURCES);
  const extras = results.slice(NUM_SOURCES);

  console.log(
    `  [Scraper] Extracting full text for ${forAI.length} AI source(s), ${extras.length} extra link(s)...`
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

module.exports = { searchWhitelist, extractArticleText, retrieveSources, isWhitelisted, isContestedQuery };
