// research.js
// "Emerging Research" section: a plainly-labeled feed of new, NOT-yet-
// peer-reviewed preprints (arXiv / bioRxiv / SSRN -- our existing Tier 2
// preprint domains) related to the question, ranked using a real signal
// (citation count + citation velocity) rather than recency alone.
//
// Framing rule, on purpose: this is "interesting + new + unverified," never
// "rescued from algorithmic suppression." That framing is the same
// rhetorical shape as most scientific misinformation ("what they don't want
// you to know") and would undercut the whole point of tiering preprints
// below peer-reviewed sources in the first place. Keep copy neutral --
// curiosity, not persecution -- in whatever calls this data.

const fetch = require("node-fetch");

const SEMANTIC_SCHOLAR_SEARCH_URL = "https://api.semanticscholar.org/graph/v1/paper/search";
const FIELDS = "title,abstract,year,venue,citationCount,publicationDate,externalIds,url";
const MAX_RESULTS = 5;
const ABSTRACT_SNIPPET_CHARS = 220;

const PREPRINT_VENUE_HINTS = ["arxiv", "biorxiv", "medrxiv", "ssrn", "preprint"];

/**
 * A paper counts as an eligible "emerging research" preprint only if it's
 * clearly unreviewed -- has an arXiv id, or its venue string names one of
 * our known preprint servers. This mirrors the Tier 2 preprint domains
 * already defined in config.js (arxiv.org, ssrn.com) rather than treating
 * any low-citation paper as "emerging."
 */
function isEligiblePreprint(paper) {
  if (paper?.externalIds?.ArXiv) return true;
  const venue = (paper.venue || "").toLowerCase();
  return PREPRINT_VENUE_HINTS.some((hint) => venue.includes(hint));
}

function buildLink(paper) {
  if (paper?.externalIds?.ArXiv) {
    return `https://arxiv.org/abs/${paper.externalIds.ArXiv}`;
  }
  if (paper?.externalIds?.DOI) {
    return `https://doi.org/${paper.externalIds.DOI}`;
  }
  return paper.url || null;
}

function snippet(abstract) {
  if (!abstract) return "";
  const trimmed = abstract.trim();
  if (trimmed.length <= ABSTRACT_SNIPPET_CHARS) return trimmed;
  const cut = trimmed.slice(0, ABSTRACT_SNIPPET_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 120 ? lastSpace : ABSTRACT_SNIPPET_CHARS)}…`;
}

/**
 * citationVelocity: citations accrued per year since publication. This is
 * the "real signal" called for in the handoff -- separates a 2-year-old
 * paper with 40 citations (velocity ~20/yr, genuinely picking up steam)
 * from a 2-year-old paper with 40 citations that's actually stalled, and
 * both from a brand-new paper that hasn't had time to accrue citations yet
 * (velocity is undefined/null in that case -- shown as "too new to rank" by
 * whatever renders this, not silently treated as zero).
 */
function citationVelocity(paper) {
  if (!paper.publicationDate && !paper.year) return null;
  const published = paper.publicationDate
    ? new Date(paper.publicationDate)
    : new Date(`${paper.year}-01-01`);
  const ageMs = Date.now() - published.getTime();
  const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365);
  if (ageYears < 0.08) return null; // under ~a month old -- too new to be meaningful
  return Number(((paper.citationCount || 0) / ageYears).toFixed(1));
}

/**
 * @param {string} question
 * @returns {Promise<Array>} up to MAX_RESULTS preprints, each:
 *   { title, link, year, venue, citationCount, citationVelocity, summary }
 *   sorted by citation velocity (nulls -- too-new-to-rank -- placed after
 *   any ranked results, newest first among themselves).
 */
async function findEmergingResearch(question) {
  const url = `${SEMANTIC_SCHOLAR_SEARCH_URL}?query=${encodeURIComponent(question)}&fields=${FIELDS}&limit=20`;

  let data;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VeritasBot/0.1)" },
    });
    if (!res.ok) throw new Error(`Semantic Scholar request failed (${res.status})`);
    data = await res.json();
  } catch (err) {
    console.warn("Emerging research lookup failed:", err.message);
    return [];
  }

  const papers = (data.data || []).filter(isEligiblePreprint).filter((p) => buildLink(p));

  const withVelocity = papers.map((p) => ({
    title: p.title,
    link: buildLink(p),
    year: p.year || null,
    venue: p.venue || "preprint",
    citationCount: p.citationCount ?? 0,
    citationVelocity: citationVelocity(p),
    summary: snippet(p.abstract),
  }));

  withVelocity.sort((a, b) => {
    if (a.citationVelocity === null && b.citationVelocity === null) {
      return (b.year || 0) - (a.year || 0);
    }
    if (a.citationVelocity === null) return 1;
    if (b.citationVelocity === null) return -1;
    return b.citationVelocity - a.citationVelocity;
  });

  return withVelocity.slice(0, MAX_RESULTS);
}

module.exports = { findEmergingResearch };
