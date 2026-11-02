// retrieve.js
// Step 1 + 2 of the pipeline: domain-scoped search via Serper.dev,
// then full-text extraction with smart, fast, and balanced query de-biasing.

const fetch = require("node-fetch");
const { JSDOM } = require("jsdom");
const { Readability } = require("@mozilla/readability");
const OpenAI = require("openai");
const { NUM_SOURCES, READ_MORE_TOTAL, WHITELIST_DOMAINS } = require("./config");

const openai = new OpenAI();

const DOMAIN_STRINGS = WHITELIST_DOMAINS.map((d) => d.domain);

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

/**
 * Look up the whitelist entry (tier + label) for a URL's hostname, if any.
 */
function getDomainMeta(link) {
  try {
    const hostname = new URL(link).hostname.replace(/^www\./, "");
    return (
      WHITELIST_DOMAINS.find(
        (d) => hostname === d.domain || hostname.endsWith(`.${d.domain}`)
      ) || null
    );
  } catch {
    return null;
  }
}

function isWhitelisted(link) {
  return getDomainMeta(link) !== null;
}

/**
 * Split domains into chunks and build "(site:a OR site:b OR ...)" groups.
 * Chunking keeps each query short/fast and lets us run them in parallel
 * instead of relying on one giant OR string across ~30 domains.
 */
function buildSiteFilterGroups(domains, chunkSize = 8) {
  const groups = [];
  for (let i = 0; i < domains.length; i += chunkSize) {
    const chunk = domains.slice(i, i + chunkSize);
    groups.push(`(${chunk.map((d) => `site:${d}`).join(" OR ")})`);
  }
  return groups;
}

const SITE_FILTER_GROUPS = buildSiteFilterGroups(DOMAIN_STRINGS);

function toResultShape(item) {
  const meta = getDomainMeta(item.link);
  return {
    title: item.title,
    link: item.link,
    snippet: item.snippet || "",
    tier: meta ? meta.tier : null,
    tierLabel: meta ? meta.label : null,
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

Keep the search terms objective and stripped of emotional/loaded words, but
KEEP specific named entities, proper nouns, dates, and technical terms from
the original question -- these queries will be run against a narrow set of
academic/institutional domains (site: filters already applied separately),
so losing specificity to save words hurts result quality far more than a
slightly longer query would. Aim for 4-7 words, not 2-4 -- enough to stay
specific while still reading as a clean search query, not a sentence.

Example for: "How did they fake the moon landing?"
Query A: "Apollo 11 moon landing physical evidence"
Query B: "Apollo moon landing conspiracy theory claims"

Respond ONLY with a valid JSON object of this exact shape:
{
  "query_supporting": "concise search query for Side A",
  "query_opposing": "concise search query for Side B"
}`;

  try {
    // Cheap/fast model is fine here -- this is a small rewriting task, not
    // the grounded-synthesis step, so it doesn't need the stronger model.
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
 * Domain-scoped whitelist search. Instead of running one generic Google
 * query and hoping whitelisted domains show up in the top 40 results, we
 * fan out one query PER site: group (query + "(site:a OR site:b ...)"),
 * so every result Google returns is already scoped to our sources. This
 * gives far higher yield and relevance than post-hoc filtering, especially
 * for short/de-biased queries where generic results skew toward news
 * aggregators, Wikipedia, Reddit, etc. that never make the whitelist.
 *
 * Results are sorted by tier (1 = most trusted first) before being trimmed,
 * so if we get more whitelisted hits than we need, we keep the best ones.
 *
 * isWhitelisted() is still applied afterward as a safety net -- site:
 * filters are a strong signal to Google/Serper but not a hard guarantee.
 */
async function searchWhitelist(query, resultsPerGroup = 10) {
  try {
    const groupQueries = SITE_FILTER_GROUPS.map(
      (siteFilter) => `${query} ${siteFilter}`
    );

    const groupResults = await Promise.all(
      groupQueries.map((q) =>
        runSerperQuery(q, resultsPerGroup).catch((err) => {
          console.error(`Whitelist group search failed for "${q}":`, err.message);
          return [];
        })
      )
    );

    const combined = groupResults.flat();
    const filtered = combined.filter((r) => isWhitelisted(r.link));

    // De-dupe by link (multiple groups or domains can surface the same URL)
    const seen = new Set();
    const deduped = filtered.filter((r) => {
      if (seen.has(r.link)) return false;
      seen.add(r.link);
      return true;
    });

    if (deduped.length > 0) {
      const shaped = deduped.map(toResultShape);
      // Best tier first (nulls/unranked last), stable within tier
      shaped.sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99));
      return shaped.slice(0, READ_MORE_TOTAL);
    }
  } catch (err) {
    console.error(`Whitelist search failed for "${query}":`, err.message);
  }
  return [];
}

/**
 * Fetch a URL and extract clean article text.
 * @returns {{text: string, extracted: boolean}} extracted=true means this is
 *   real scraped article text; false means Readability failed/was too short
 *   and this is Google's own (often truncated, "...") search snippet instead
 *   -- fine as supporting context, but never safe to quote verbatim as a
 *   standalone direct answer.
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

    return { text: article.textContent.trim().slice(0, 3000), extracted: true };
  } catch (err) {
    return { text: fallbackSnippet || "", extracted: false };
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

    // Each side is already tier-sorted internally (best first); interleave
    // so both perspectives are represented rather than one side dominating.
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

  // --- NEW UNDERDOG LOGIC ---
  // Separate Tier 1 (Establishment) and Tier 2/3 (Underdogs)
  const tier1Results = results.filter(r => r.tier === 1);
  const underdogResults = results.filter(r => r.tier > 1 || r.tier === null);

  // We want up to 6 total sources, but we want to GUARANTEE at least 2 slots for underdogs if they exist.
  const numUnderdogsToKeep = Math.min(2, underdogResults.length);
  const numTier1ToKeep = NUM_SOURCES - numUnderdogsToKeep;

  const forAI = [
    ...tier1Results.slice(0, numTier1ToKeep),
    ...underdogResults.slice(0, numUnderdogsToKeep)
  ];
  
  // The rest go to the 'Read More' drawer
  const extras = [
    ...tier1Results.slice(numTier1ToKeep),
    ...underdogResults.slice(numUnderdogsToKeep)
  ];
  // --------------------------

  console.log(
    `  [Scraper] Extracting full text for ${forAI.length} AI source(s) (including ${numUnderdogsToKeep} underdogs)...`
  );

  const scrapePromises = forAI.map(async (r, i) => {
    const { text, extracted } = await extractArticleText(r.link, r.snippet);
    return {
      index: i + 1,
      title: r.title,
      link: r.link,
      text,
      extracted,
      tier: r.tier,
      tierLabel: r.tierLabel,
    };
  });

  const aiSources = await Promise.all(scrapePromises);

  const moreSources = extras.map((r) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
    tier: r.tier,
    tierLabel: r.tierLabel,
  }));

  return { aiSources, moreSources, searchStrategy };
}

module.exports = { searchWhitelist, extractArticleText, retrieveSources, isWhitelisted, getDomainMeta };
