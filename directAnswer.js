// directAnswer.js
// Picks a short, verbatim, cited snippet that best answers the question --
// a Google-style "featured snippet" -- instead of relying entirely on an
// LLM to paraphrase the sources. This is the primary factual answer;
// summarize.js's job becomes writing CONTEXT around this snippet, not
// re-deriving the fact itself.

const OpenAI = require("openai");

const openai = new OpenAI();

// Small nudge so that when two passages are nearly equally relevant, the
// higher-trust-tier one wins -- without letting tier override genuine
// relevance differences.
const TIER_BONUS = { 1: 0.03, 2: 0, 3: -0.02 };

// Keep snippets short and search-result-length, not a full paragraph
// reproduction -- closer to how a search engine shows a result than to
// republishing the source's writing.
const MAX_SNIPPET_CHARS = 320;

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Split scraped article text into paragraph-ish chunks worth considering as
 * a standalone answer. Very short fragments (nav text, captions leftover
 * from extraction) are filtered out, as are any that still carry Google's
 * own truncation marker ("...") -- those read as broken sentence fragments
 * when quoted verbatim and should never be shown as a headline direct answer.
 */
function splitIntoCandidates(text) {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 60 && p.length <= 800)
    .filter((p) => !p.includes("...") && !p.includes("…"));
}

function trimToSnippetLength(text) {
  if (text.length <= MAX_SNIPPET_CHARS) return text;
  const cut = text.slice(0, MAX_SNIPPET_CHARS);
  const lastSentenceEnd = cut.lastIndexOf(". ");
  return lastSentenceEnd > 120 ? cut.slice(0, lastSentenceEnd + 1) : cut + "…";
}

/**
 * @param {string} question
 * @param {Array} aiSources - [{ index, title, link, text, extracted, tier, tierLabel }]
 * @returns {Promise<object|null>} the selected snippet + its source, or null
 *   if no usable candidate paragraphs were found -- e.g. every source failed
 *   real extraction and only has a truncated snippet fallback. In that case
 *   the frontend's existing "no direct answer" path handles it gracefully:
 *   the AI-written context becomes the primary answer instead of a caption.
 */
async function selectDirectAnswer(question, aiSources) {
  const candidates = [];
  for (const source of aiSources) {
    // Snippet-fallback sources (extracted === false) are real Google
    // search-result text, often mid-sentence truncated -- fine to inform
    // the AI's context/evidenceNotes pass, but never safe to quote verbatim
    // as if it were a complete, standalone answer.
    if (source.extracted === false) continue;

    const paras = splitIntoCandidates(source.text || "").slice(0, 6);
    for (const text of paras) {
      candidates.push({ text, source });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  let embeddings;
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: [question, ...candidates.map((c) => c.text)],
    });
    embeddings = response.data.map((d) => d.embedding);
  } catch (err) {
    console.warn("Direct-answer embedding failed, skipping snippet selection:", err.message);
    return null;
  }

  const questionVec = embeddings[0];
  let best = null;

  candidates.forEach((candidate, i) => {
    const rawScore = cosineSimilarity(questionVec, embeddings[i + 1]);
    const score = rawScore + (TIER_BONUS[candidate.source.tier] ?? 0);
    if (!best || score > best.score) {
      best = { score, rawScore, candidate };
    }
  });

  if (!best) return null;

  const { source } = best.candidate;
  return {
    text: trimToSnippetLength(best.candidate.text),
    sourceIndex: source.index,
    title: source.title,
    link: source.link,
    tier: source.tier,
    tierLabel: source.tierLabel,
    matchScore: Number(best.rawScore.toFixed(3)),
  };
}

module.exports = { selectDirectAnswer };
