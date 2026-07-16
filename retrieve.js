// retrieve.js
// Step 1 + 2 of the pipeline: domain-scoped search via Serper.dev,
// then full-text extraction with smart, fast, and balanced query de-biasing.

const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const OpenAI = require("openai"); 
const { NUM_SOURCES, READ_MORE_TOTAL, WHITELIST_DOMAINS } = require("./config");

const openai = new OpenAI();

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
 * STRIPS BIAS & DE-BIASED ENGINE: Rewrites highly biased or leading questions
 * into TWO structurally balanced, objective search terms.
 */
async function generateDeBiasedQueries(rawQuestion) {
  const systemPrompt = `You are an elite search query de-biasing engine.
Your task is to take a user's question (which may be loaded, biased, leading, or a conspiracy theory) and split it into TWO separate neutral, academic queries to find balanced evidence.

- Query A: Search terms to find consensus, proof, or mainstream evidence.
- Query B: Search terms to find alternative perspectives, criticisms, or skeptics' arguments.
Keep the search terms highly concise (2-4 words), objective, and stripped of emotional words.

Example for: "How did they fake the moon landing?"
Query A: "Apollo moon landing evidence"
Query B: "Apollo moon landing conspiracy arguments"

Respond ONLY with a valid JSON object of this exact shape:
{
  "query_supporting": "concise search query for Side A",
  "query_opposing": "concise search query for Side B"
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
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.warn("Failed to de-bias query, falling back to original:", error.message);
    return { query_supporting: rawQuestion, query_opposing: rawQuestion };
  }
}

/**
 * Highly optimized, ultra-fast whitelist search.
 * Grabs the top 40 Google results in a single roundtrip, then filters them.
 */
async function searchWhitelist(query) {
  try {
    const plainResults = await runSerperQuery(query, 40);
    const filtered = plainResults.filter((r) => isWhitelisted(r.link));

    if (filtered.length > 0) {
      return filtered.slice(0, READ_MORE_TOTAL).map(toResultShape);
    }
  } catch (err) {
    console.error(`Whitelist search failed for "${query}":`, err.message);
  }
  return [];
}

/**
 * Fetch a URL and extract clean article text.
 */
async function extractArticleText(url, fallbackSnippet) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); 

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

    return article.textContent.trim().slice(0, 3000); 
  } catch (err) {
    return fallbackSnippet || "";
  }
}

/**
 * Full retrieval step. Generates clean, dual-perspective queries ONLY when debias is requested.
 */
async function retrieveSources(query, mode, debias = false) {
  let results = [];
  let searchStrategy = { isContested: false, queryA: "", queryB: "" };

  // Only split the search if the user explicitly has debias enabled
  if (debias === true || debias === "true") {
    console.log(`[Retrieve] De-bias requested. Rewriting queries neutrally...`);

    const strategy = await generateDeBiasedQueries(query);
    console.log(`   -> Side A query: "${strategy.query_supporting}"`);
    console.log(`   -> Side B query: "${strategy.query_opposing}"`);

    searchStrategy = {
      isContested: true,
      queryA: strategy.query_supporting,
      queryB: strategy.query_opposing
    };

    const [resultsA, resultsB] = await Promise.all([
      searchWhitelist(strategy.query_supporting),
      searchWhitelist(strategy.query_opposing)
    ]);

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
    // Normal single-sided search
    console.log(`[Retrieve] De-bias disabled. Running direct search...`);
    results = await searchWhitelist(query);
  }

  if (!results || results.length === 0) {
    return { aiSources: [], moreSources: [], searchStrategy };
  }

  const forAI = results.slice(0, NUM_SOURCES);
  const extras = results.slice(NUM_SOURCES);

  console.log(
    `  [Scraper] Extracting full text for ${forAI.length} AI source(s)...`
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

module.exports = { searchWhitelist, extractArticleText, retrieveSources, isWhitelisted };
