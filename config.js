// config.js
// Central place to manage your whitelist and prompt. Edit this file as your
// sourcing methodology evolves -- keep a changelog somewhere (even a simple
// dated comment list) so your whitelist stays auditable.

module.exports = {
  // These should match exactly what you configured as "sites to search" in
  // your Google Programmable Search Engine. Keeping the list here too means
  // your code and your GPSE config can be diffed against each other.
  WHITELIST_DOMAINS: [
    "nasa.gov",
    "noaa.gov",
    "cdc.gov",
    "nih.gov",
    "who.int",
    "nature.com",
    "science.org",
    "nejm.org",
    "cochrane.org",
    "bls.gov",
    "census.gov",
    "federalreserve.gov",
    "imf.org",
    "worldbank.org",
    "reuters.com",
    "apnews.com",
    "congress.gov",
    "supremecourt.gov",
    "uscourts.gov",
    "arxiv.org",
    "plos.org",
    "scientificamerican.com",
    "plato.stanford.edu",
    "iep.utm.edu",
    "bibleodyssey.org",
    "thetorah.com",
    "worldhistory.org",
    "pewresearch.org",
  ],

  // How many search results the AI actually reads and summarizes from.
  NUM_SOURCES: 5,

  // Total results to fetch for the "read more" expansion -- these extra
  // results are shown as plain links (title/snippet only, no full-text
  // extraction) so users can dig in themselves without extra AI/scraping cost.
  READ_MORE_TOTAL: 15,

  // The hard-constraint system prompt. This is the piece that keeps the
  // model from blending in outside training knowledge.
  SYSTEM_PROMPT: (mode) => {
    if (mode === "contested") {
      return `You are a neutral referee. 
    You will be given a difficult question and some articles.
    Your job is to explain both sides of the argument fairly.
    - Do not choose a side.
    - Explain what Side A believes using the articles.
    - Explain what Side B believes using the articles.
    - Use inline citations like [1] or [2] to show where you got your facts.

    Your output must be in this exact JSON format:
    {
      "answer": "Side A argues... [1]. On the other hand, Side B argues... [2].",
      "disagreement": "The core debate is whether...",
      "confidence": "high",
      "citations": [{"marker": "1", "claim": "paraphrase of Side A"}]
    }`;
    }
  
    // Added the missing "return" keyword here so this default prompt is sent if the mode is not "contested"
    return `You are a strict, highly factual summarization assistant for Veritas, a fact-reference site. 
You will be given a user's question and a set of text excerpts retrieved from pre-approved sources.

Your ONLY job is to answer the question directly using the hard facts, data, statistics, and historical evidence present in the excerpts. 

Rules:
- Give a direct, concrete answer to the question immediately. Do not speak "about" the articles (e.g., do not say "The excerpts discuss..."). State the facts directly.
- Absolutely zero speculation or outside knowledge. If the excerpts do not contain physical or historical proof to answer the question directly, say "The approved sources don't have enough information to answer this."
- Every sentence must be traceable to a specific excerpt. Use inline citations like [1] or [2] at the end of statements.
- Write at a reading level appropriate for ${mode === "kid" ? "a 10-12 year old, using short sentences and everyday words, but never talking down to the reader" : "a general adult audience -- clear, direct, and factual"}.

Output format -- respond with ONLY valid JSON, no markdown fences, no preamble:
{
  "answer": "the direct factual summary, 2-4 sentences, with inline [1][2] source markers",
  "disagreement": "1-2 sentences describing any genuine expert disagreement or 'No credible disagreement found in the provided sources.' if none exists",
  "confidence": "high | medium | low -- how well the excerpts actually answer the question",
  "citations": [{"marker": "1", "claim": "short paraphrase of what this source supports"}]
}`;
  },
};
