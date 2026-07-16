# Veritas RAG engine (MVP)

Minimal working pipeline: question -> whitelist-only search -> full article
extraction -> Claude summary constrained to only the retrieved text.

## Setup

1. `cp .env.example .env` and fill in your two keys:
   - `OPENAI_API_KEY` -- from platform.openai.com
   - `SERPER_API_KEY` -- from serper.dev (2,500 free queries, no card
     required at signup)

2. `npm install`

3. Run it:
   ```
   node ask.js "is climate change caused by humans" adult
   node ask.js "do vaccines cause autism" kid
   ```

## What each file does

- `config.js` -- your whitelist domains + the grounded-summary system prompt.
  Edit the whitelist here as your sourcing methodology grows.
- `retrieve.js` -- calls Serper.dev (a Google SERP API) with `site:` filters
  built from your whitelist, double-checks each result's hostname actually
  matches the whitelist before trusting it, then fetches + cleans the actual
  article text with Readability (falls back to the search snippet if a site
  blocks scraping).
- `summarize.js` -- sends the retrieved excerpts to OpenAI (gpt-4o) with a
  system prompt that forbids using outside knowledge, and asks for
  structured JSON back (answer, disagreement note, confidence, citations).
  Uses `response_format: json_object` to enforce valid JSON. This is the one
  file to touch if you ever swap or A/B test a different model provider.
- `ask.js` -- CLI glue: run a question end to end and print the result.

## How to validate this before trusting it

Run it against the same questions you already hand-wrote FAQ answers for.
Check three things each time:

1. **Does the answer match your hand-written version in substance?** If it
   contradicts your verified answer, something's wrong with either retrieval
   (bad sources came back) or the model is leaking outside knowledge.
2. **Is "confidence" honest?** Feed it a question your whitelist genuinely
   can't answer well and confirm it says so (low confidence, "not enough
   information") instead of guessing.
3. **Are citations real?** Manually open each `sources[].link` and check the
   `citations[].claim` is actually supported by that page. This is the check
   that catches hallucinated attribution -- do it for the first few dozen
   answers by hand before you trust the pipeline at scale.

## Known limitations to fix before production

- No caching -- repeat questions re-search and re-call the API every time.
  Add a lookup against your Xano FAQ database *before* this pipeline runs at
  all, and cache AI-generated answers for some TTL (e.g. 24-48h) so you're not
  paying for the same question twice.
- No rate limiting / retry logic.
- Readability extraction fails silently on some JS-heavy sites -- worth
  logging which domains fail often so you know which whitelist sources need a
  different extraction approach.
- The whitelist here is a starting set (~19 domains) across science, health,
  economics, and civics -- expand deliberately, and log changes with a
  reason, per the methodology approach discussed earlier.