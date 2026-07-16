// summarize.js
// Step 3: feed the retrieved excerpts to an LLM with a hard grounding
// constraint, get back a structured, cited answer.

const OpenAI = require("openai");
const { SYSTEM_PROMPT } = require("./config");

// This automatically pulls process.env.OPENAI_API_KEY
const client = new OpenAI();

/**
 * @param {string} question - the user's original question
 * @param {Array} sources - [{ index, title, link, text, tier, tierLabel }] from retrieve.js
 * @param {"kid"|"adult"|"contested"} mode
 */
async function summarize(question, sources, mode = "adult") {
  if (!sources || sources.length === 0) {
    return {
      answer:
        "The approved sources don't have enough information to answer this.",
      disagreement: "No sources were found to evaluate.",
      confidence: "low",
      evidenceNotes: [],
      citations: [],
    };
  }

  const excerptsBlock = sources
    .map(
      (s) =>
        `[${s.index}] source: ${s.link}\ntrust tier: ${s.tier ?? "unranked"} (${s.tierLabel || "no tier metadata"})\ntitle: ${s.title}\n${s.text}\n`
    )
    .join("\n---\n");

  const userMessage = `User question: ${question}\n\nExcerpts:\n${excerptsBlock}`;

  const response = await client.chat.completions.create({
    // Full model, not mini -- this is the grounded-synthesis step where
    // instruction-following on "don't speculate, stay in the excerpts"
    // actually matters. The cheap de-bias query rewrite in retrieve.js
    // stays on mini since that's a much easier task.
    model: "gpt-4o-mini",
    max_tokens: 1400,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "summarize_response",
        strict: true,
        schema: {
          type: "object",
          properties: {
            evidenceNotes: {
              type: "array",
              description:
                "One entry per excerpt, filled BEFORE the answer. Pure extraction: what does this specific excerpt support, and at what trust tier.",
              items: {
                type: "object",
                properties: {
                  marker: { type: "string" },
                  tier: { type: "string" },
                  claim: { type: "string" }
                },
                required: ["marker", "tier", "claim"],
                additionalProperties: false
              }
            },
            answer: { type: "string" },
            disagreement: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            citations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  marker: { type: "string" },
                  claim: { type: "string" }
                },
                required: ["marker", "claim"],
                additionalProperties: false
              }
            }
          },
          required: ["evidenceNotes", "answer", "disagreement", "confidence", "citations"],
          additionalProperties: false
        }
      }
    },
    messages: [
      { role: "system", content: SYSTEM_PROMPT(mode) },
      { role: "user", content: userMessage },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    parsed = {
      answer: raw,
      disagreement: "(unparsed model output -- check formatting)",
      confidence: "low",
      evidenceNotes: [],
      citations: [],
    };
  }

  // Preserve sources array structure for the final output, tier included
  // so the frontend can show a trust badge per source if you want later.
  parsed.sources = sources.map((s) => ({
    index: s.index,
    title: s.title,
    link: s.link,
    tier: s.tier,
    tierLabel: s.tierLabel,
  }));

  return parsed;
}

module.exports = { summarize };
