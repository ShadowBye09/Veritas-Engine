// retrieve.js
// Step 1 + 2 of the pipeline: domain-scoped search via Serper.dev
// (a Google SERP API), then full-text extraction.

const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const OpenAI = require("openai"); // Added missing import!
const { NUM_SOURCES, READ_MORE_TOTAL, WHITELIST_DOMAINS } = require("./config");

// Initialize OpenAI client
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
 * SMART DE-BIAS ENGINE: Decides if a query needs splitting, then creates the queries.
 */
async function generateDeBiasedQueries(rawQuestion) {
  const systemPrompt = `You are an elite search query analyzer for Veritas, an objective research engine.
Your task is to analyze the user's question and determine if it represents a topic with genuine scholarly, philosophical, scientific, or cultural debate (a "contested" topic), or if it is a simple factual request (e.g., "what is the capital of France", "how tall is the eiffel tower").

If it IS contested, biased, or involves controversy/debate:
1. Set "is_contested" to true.
2. Create "query_supporting": a neutral academic search finding evidence supporting the premise.
3. Create "query_opposing": a neutral academic search finding counterarguments or skeptic rebuttals.

If it is NOT contested (simple facts):
1. Set "is_contested" to false.
2. Leave the queries empty strings.

Respond ONLY with a valid JSON object of this exact shape:
{
  "is_contested": boolean,
  "query_supporting": "string",
  "query_opposing": "string"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Analyze and de-bias this question: "${rawQuestion}"` }
      ]
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.warn("Failed to de-bias query, falling back to original:", error.message);
    return { is_contested: false, query_supporting: "", query_opposing: "" };
  }
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function searchWhitelist(query) {
  const plainResults = await runSerperQuery(query, READ_MORE_TOTAL);
  const filtered = plainResults.filter((r) => isWhitelisted(r.link));

  if (filtered.length >= NUM_SOURCES) {
    return filtered.map(toResultShape);
  }

  const domainChunks = chunkArray(WHITELIST_DOMAINS, 5);
  const batchPromises = domainChunks.map(async (chunk) => {
    try {
      const siteFilter = chunk.map(domain => `site:${domain}`).join(" OR ");
      const combinedQuery = `${query} (${siteFilter})`;
      
      const results = await runSerperQuery(combinedQuery, 3);
      return results.filter((r) => isWhitelisted(r.link));
    } catch (err) {
      return [];
    }
  });

  const batchResults = (await Promise.all(batchPromises)).flat();

  const merged = [...filtered, ...batchResults];
  const seen = new Set();
  const deduped = merged.filter((r) => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });

  return deduped.slice(0, READ_MORE_TOTAL).map(toResultShape);
}

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
    return fallbackSnippet || "";
  }
}

/**
 * Full retrieval step with optional smart de-biased partitioning.
 */
async function retrieveSources(query, mode = "adult", debias = true) {
  let results = [];
  let searchStrategy = { isContested: false, queryA: "", queryB: "" };

  // Determine if we should perform De-Biased query splitting
  if (debias || mode === "contested" || isContestedQuery(query)) {
    const strategy = await generateDeBiasedQueries(query);
    
    if (strategy.is_contested) {
      console.log(`[Retrieve] Contested topic. Split: "${strategy.query_supporting}" vs "${strategy.query_opposing}"`);
      searchStrategy = { isContested: true, queryA: strategy.query_supporting, queryB: strategy.query_opposing };

      // Fetch both sides in parallel
      const [resultsA, resultsB] = await Promise.all([
        searchWhitelist(strategy.query_supporting),
        searchWhitelist(strategy.query_opposing)
      ]);

      // Interleave results to guarantee balance
      const combined = [];
      const maxLen = Math.max(resultsA.length, resultsB.length);
      for (let i = 0; i < maxLen; i++) {
        if (resultsA[i]) combined.push(resultsA[i]);
        if (resultsB[i]) combined.push(resultsB[i]);
      }

      const seen = new Set();
      results = combined.filter((r) => {
        if (seen.has(r.link)) return false;
        seen.add(r.link);
        return true;
      });
    } else {
      console.log(`[Retrieve] Topic is purely factual. Skipping dual-search partition.`);
      results = await searchWhitelist(query);
    }
  } else {
    results = await searchWhitelist(query);
  }

  if (!results || results.length === 0) {
    return { aiSources: [], moreSources: [], searchStrategy };
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

  return { aiSources, moreSources, searchStrategy };
}

module.exports = { searchWhitelist, extractArticleText, retrieveSources, isWhitelisted, isContestedQuery };
