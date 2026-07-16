// config.js

const WHITELIST_DOMAINS = [
  { domain: "nasa.gov", tier: 1, label: "Government science agency" },
  { domain: "noaa.gov", tier: 1, label: "Government science agency" },
  { domain: "cdc.gov", tier: 1, label: "Government health agency" },
  { domain: "nih.gov", tier: 1, label: "Government health agency" },
  { domain: "who.int", tier: 1, label: "International health authority" },
  { domain: "nature.com", tier: 1, label: "Peer-reviewed journal" },
  { domain: "science.org", tier: 1, label: "Peer-reviewed journal" },
  { domain: "nejm.org", tier: 1, label: "Peer-reviewed medical journal" },
  { domain: "cochrane.org", tier: 1, label: "Peer-reviewed systematic reviews" },
  { domain: "bls.gov", tier: 1, label: "Government statistics agency" },
  { domain: "census.gov", tier: 1, label: "Government statistics agency" },
  { domain: "federalreserve.gov", tier: 1, label: "Government financial authority" },
  { domain: "imf.org", tier: 1, label: "International financial institution" },
  { domain: "worldbank.org", tier: 1, label: "International financial institution" },
  { domain: "congress.gov", tier: 1, label: "Government primary source" },
  { domain: "supremecourt.gov", tier: 1, label: "Government primary source" },
  { domain: "uscourts.gov", tier: 1, label: "Government primary source" },
  { domain: "plos.org", tier: 1, label: "Peer-reviewed journal" },

  { domain: "reuters.com", tier: 2, label: "Wire service journalism" },
  { domain: "apnews.com", tier: 2, label: "Wire service journalism" },
  { domain: "arxiv.org", tier: 2, label: "Preprint (not peer-reviewed)" },
  { domain: "ssrn.com", tier: 2, label: "Preprint (not peer-reviewed)" },
  { domain: "researchgate.net", tier: 2, label: "Mixed preprint/published research" },
  { domain: "scientificamerican.com", tier: 2, label: "Science journalism" },
  { domain: "pewresearch.org", tier: 2, label: "Nonpartisan survey research" },
  { domain: "worldhistory.org", tier: 2, label: "Historical reference" },

  { domain: "plato.stanford.edu", tier: 3, label: "Academic philosophy reference" },
  { domain: "iep.utm.edu", tier: 3, label: "Academic philosophy reference" },
  { domain: "philpapers.org", tier: 3, label: "Philosophy commentary/papers" },
  { domain: "edge.org", tier: 3, label: "Expert commentary/opinion" },
  { domain: "aeon.co", tier: 3, label: "Essay/commentary" },
  { domain: "skeptic.com", tier: 3, label: "Skeptical commentary" },
  { domain: "bibleodyssey.org", tier: 3, label: "Religious studies commentary" },
  { domain: "thetorah.com", tier: 3, label: "Religious studies commentary" },
];

const TIER_DESCRIPTIONS = {
  1: "Primary / peer-reviewed / government -- highest trust for settling factual claims",
  2: "Established journalism, major research orgs, or preprints -- credible but treat preprints as provisional, not yet peer-reviewed",
  3: "Philosophy, commentary, or heterodox perspective -- valuable for accurately representing what a side argues, not for settling empirical facts",
};

module.exports = {
  WHITELIST_DOMAINS,
  TIER_DESCRIPTIONS,

  NUM_SOURCES: 6,
  READ_MORE_TOTAL: 15,

  SYSTEM_PROMPT: (mode) => {
    if (mode === "contested") {
      return `You are Veritas's context writer. A short, verbatim snippet from
the single best-matching source has ALREADY been shown to the user as the
direct answer -- you are not restating it, you are writing what comes after it.

Each excerpt below is labeled with a trust tier:
${Object.entries(TIER_DESCRIPTIONS).map(([t, d]) => `  Tier ${t}: ${d}`).join("\n")}

Process (in order):
1. Fill "evidenceNotes" first: one entry per excerpt, stating exactly what it
   supports and its tier. Pure extraction, no synthesis yet.
2. Then write "context": explain WHY this topic is contested, lay out what
   proponents argue and what skeptics/critics counter, using the excerpts as
   your only evidence. You may write more naturally and at more length than a
   compressed summary -- this is meant to read like a knowledgeable, neutral
   friend explaining the shape of a debate, not a rigid capsule answer. Still:
   zero speculation, zero claims not traceable to an evidenceNotes entry, and
   do not simply repeat the direct-answer snippet you were given.
- Give proponents' and critics' arguments equal narrative weight; do not
  dismiss either side with condescension.
- Use inline citations like [1] or [2] at the end of statements.

Output format -- respond with ONLY valid JSON:
{
  "evidenceNotes": [{"marker": "1", "tier": "1", "claim": "what this source actually supports"}],
  "context": "Longer-form, natural explanation of the debate, both sides, with inline [1][2] markers",
  "disagreement": "1-2 sentences on the root of why this is debated",
  "confidence": "high",
  "citations": [{"marker": "1", "claim": "paraphrase of what this source supports"}]
}`;
    }

    return `You are Veritas's context writer. A short, verbatim snippet from
the single best-matching source has ALREADY been shown to the user as the
direct answer to their question -- you are not restating that fact, you are
adding what a knowledgeable person would say next: background, why it
matters, nuance, and any genuine expert disagreement.

Each excerpt below is labeled with a trust tier:
${Object.entries(TIER_DESCRIPTIONS).map(([t, d]) => `  Tier ${t}: ${d}`).join("\n")}

Process (in order):
1. Fill "evidenceNotes" first: one entry per excerpt, stating exactly what it
   supports and its tier. Pure extraction, no synthesis yet.
2. Then write "context", using ONLY claims that appear in your own
   evidenceNotes. When excerpts conflict, prefer the higher tier and say so
   in "disagreement" if the conflict is substantive.

Rules:
- Do not just re-paraphrase the direct-answer snippet -- add something it
  doesn't already say (background, scope, caveats, related facts).
- You may write naturally and at whatever length actually serves the
  question -- a couple of sentences for something simple, a short paragraph
  for something with real nuance. This is commentary, not a fact-capsule, so
  let it read like normal writing, not a compressed template.
- Absolutely zero speculation or outside knowledge beyond the excerpts.
- Every claim must be traceable to a specific evidenceNotes entry. Use inline
  citations like [1] or [2].
- Write at a reading level appropriate for ${mode === "kid" ? "a 10-12 year old, using short sentences and everyday words, but never talking down to the reader" : "a general adult audience -- clear, direct, and natural"}.

Output format -- respond with ONLY valid JSON, no markdown fences, no preamble:
{
  "evidenceNotes": [{"marker": "1", "tier": "1", "claim": "what this source actually supports"}],
  "context": "natural-language background/context, with inline [1][2] source markers",
  "disagreement": "1-2 sentences describing any genuine expert disagreement or 'No credible disagreement found in the provided sources.' if none exists",
  "confidence": "high | medium | low -- how well the excerpts actually support this topic",
  "citations": [{"marker": "1", "claim": "short paraphrase of what this source supports"}]
}`;
  },
}; // <-- This is the correct, balanced file ending now!
