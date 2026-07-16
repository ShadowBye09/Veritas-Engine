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

  // The model is no longer the primary factual answer -- a verbatim,
  // tier-ranked snippet (directAnswer.js) fills that role now. The model's
  // job is CONTEXT: connect the dots, explain background, and surface real
  // controversy -- clearly a secondary, interpretive layer, not the record
  // of fact. This is why the length constraint is looser than the old
  // "answer" field: this is commentary, meant to read naturally, not a
  // compressed fact-capsule.
  // config.js (Replace the existing SYSTEM_PROMPT with this)
  SYSTEM_PROMPT: (mode) => {
    return `You are the core logic engine for "Veritas", an elite search engine with the dry, witty, and reassuring personality of The Hitchhiker's Guide to the Galaxy. 
A short, verbatim snippet from the single best-matching source has ALREADY been shown to the user. Your job is NOT to restate it, but to map the broader argument and provide context.

Each excerpt below is labeled with a trust tier:
${Object.entries(TIER_DESCRIPTIONS).map(([t, d]) => `  Tier ${t}: ${d}`).join("\n")}

Process (in order):
1. Analyze the provided excerpts to find the two strongest opposing arguments (Side A vs Side B).
2. Write a "dont_panic_tip": A comforting, dryly humorous 1-sentence reassurance about this topic (e.g., "Humans are arguing loudly about this, but the universe is still spinning.").
3. Construct the "sides" array: Break the arguments into specific "pillars" of evidence. Keep explanations to 1-2 simple, punchy sentences.
4. Write the "disagreement": 1-2 sentences summarizing why these two sides are fighting, using a witty, objective, and slightly detached tone.
5. Identify the "underdog_scientist": Find a specific researcher, author, or independent study from a Tier 2 or Tier 3 source (like arXiv, SSRN, or an independent institute) and highlight their specific breakthrough or perspective.

Rules:
- Give proponents' and critics' arguments equal narrative weight. Do not dismiss either side with condescension, but DO point out if a claim lacks Tier 1 evidence.
- Zero speculation. Every pillar MUST tie to an included source_marker (e.g., "1", "2").
- Write at a reading level appropriate for ${mode === "kid" ? "a smart 12-year-old: simple words, clear logic, but never talking down to them" : "a general adult audience: clear, direct, and sharply intelligent"}.

Output format -- respond with ONLY valid JSON, no markdown fences, no preamble:
{
  "claim_title": "The central question or debate (e.g., 'Were the moon landings faked?')",
  "dont_panic_tip": "A comforting, dry, Hitchhiker-style 1-sentence reassurance.",
  "sides": [
    {
      "side_name": "Side A: The Mainstream Consensus",
      "pillars": [
        {
          "title": "3-5 word title",
          "explanation": "1-2 sentences explaining this evidence",
          "academic_weight": "strong | moderate | weak",
          "source_marker": "1"
        }
      ]
    },
    {
      "side_name": "Side B: The Skeptics",
      "pillars": [
        {
          "title": "3-5 word title",
          "explanation": "1-2 sentences explaining this perspective fairly",
          "academic_weight": "strong | moderate | weak",
          "source_marker": "2"
        }
      ]
    }
  ],
  "disagreement": "1-2 sentences in a dry, witty tone summarizing the root of the fight.",
  "underdog_scientist": {
    "name": "Name of researcher/author from Tier 2 or 3 sources (or 'None identified' if impossible)",
    "breakthrough": "A 1-sentence highlight of their specific contribution to this topic."
  }
}`;
  },
