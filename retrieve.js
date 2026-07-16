// retrieve.js
// Step 1 + 2 of the pipeline: Dynamic domain routing search via Serper.dev,
// then full-text extraction.

const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const { NUM_SOURCES, READ_MORE_TOTAL, WHITELIST_DOMAINS } = require("./config");

// Define thematic subsets of your whitelist to prevent Serper query overload
const CATEGORIES = {
  humanities: [
    "plato.stanford.edu",
    "iep.utm.edu",
    "bibleodyssey.org",
    "thetorah.com",
    "worldhistory.org",
    "pewresearch.org"
  ],
  science: [
    "nasa.gov",
    "noaa.gov",
    "cdc.gov",
    "nih.gov",
    "who.int",
    "nature.com",
    "science.org",
    "nejm.org",
    "cochrane.org",
    "arxiv.org",
    "plos.org",
    "scientificamerican.com"
  ],
  news_gov: [
    "reuters.com",
    "apnews.com",
    "bls.gov",
    "census.gov",
    "federalreserve.gov",
    "imf.org",
    "worldbank.org",
    "congress.gov",
    "supremecourt.gov",
    "uscourts.gov"
  ]
};

// High-quality general default if no specific category matches
const DEFAULT_SEARCH_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "scientificamerican.com",
  "pewresearch.org",
  "worldhistory.org"
];

/**
 * Automatically determine the best whitelist domains to search based on query keywords.
 * This keeps the OR site: chain short enough to satisfy Serper's free tier constraints.
 */
function getTargetDomains(query) {
  const q = query.toLowerCase();

  // Humanities keywords (Philosophy, Religion, Ancient History)
  const humanitiesKeywords = [
    "bible", "biblical", "torah", "god", "jesus", "religion", "religious", "church", 
    "theology", "utilitarianism", "ethics", "moral", "philosophy", "philosophical", 
    "plato", "aristotle", "socrates", "kant", "documentary hypothesis", "history", "ancient"
  ];

  // Science & Health keywords
  const scienceKeywords = [
    "climate", "warming", "space", "planet", "orbit", "nasa", "physics", "quantum", 
    "particle", "star", "telescope", "disease", "vaccine", "cancer", "health", "virus", 
    "medical", "study", "scientific", "cell", "biology", "earth", "trappist"
  ];

  // Politics, Economics & News keywords
  const newsGovKeywords = [
    "gdp", "inflation", "economy", "economic", "market", "fed", "interest", "tax", 
    "law", "court", "ruling", "bill", "senate", "congress", "president", "election",
    "unemployment", "labor", "world bank", "imf", "news", "report"
  ];

  if (humanitiesKeywords.some(keyword => q.includes(keyword))) {
    console.log("  [Router] Routing query to Humanities (Philosophy, Religion & History) sources...");
    return CATEGORIES.humanities;
  }
  
  if (scienceKeywords.some(keyword => q.includes(keyword))) {
    console.log("  [Router] Routing query to Science & Health sources...");
    return CATEGORIES.science;
  }

  if (newsGovKeywords.some(keyword => q.includes(keyword))) {
    console.log("  [Router] Routing query to News, Economics & Gov sources...");
    return CATEGORIES.news_gov;
  }

  // Fallback to high-authority general sites if not classified
  console.log("  [Router] Query did not match category rules. Routing to general authority sources...");
  return DEFAULT_SEARCH_DOMAINS;
}

/**
 * Builds standard Google search queries with OR'd site filters, restricted to 
 * the dynamically targeted domains.
 */
function buildWhitelistQuery(query, targetDomains) {
  const siteFilters = targetDomains.map((d) => `site:${d}`).join(" OR ");
  return `${query} (${siteFilters})`;
}

/**
 * Search via Serper.dev, restricted to targeted whitelist domains.
 * Returns [{ title, link, snippet }]
 */
async function searchWhitelist(query) {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    throw new Error("Missing SERPER_API_KEY in environment");
  }

  const targetDomains = getTargetDomains(query);
  const fullQuery = buildWhitelistQuery(query, targetDomains);

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: fullQuery,
      num: READ_MORE_TOTAL,
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

  // Double-verify each result's hostname matches our broad whitelist domains
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
 * Full retrieval step: search, then split results.
 */
async function retrieveSources(query) {
  const results = await searchWhitelist(query);

  if (!results || results.length === 0) {
    return { aiSources: [], moreSources: [] };
  }

  const forAI = results.slice(0, NUM_SOURCES);
  const extras = results.slice(NUM_SOURCES);

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
