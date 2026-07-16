// summarize.js
// Step 3: writes CONTEXT around an already-selected direct-answer snippet.
// The model is no longer the primary factual answer -- directAnswer.js picks
// a verbatim, cited snippet for that job. This keeps the model's task to
// what LLMs are actually good at: connecting ideas and explaining nuance,
// not being the record of fact.

const OpenAI = require("openai");
const { SYSTEM_PROMPT } = require("./config");

const client = new OpenAI();

/**
 * @param {string} question
 * @param {Array} sources - [{ index, title, link, text, tier, tierLabel }]
 * @param {"kid"|"adult"|"contested"} mode
 * @param {object|null} directAnswer - the snippet already shown to the user,
 *   from directAnswer.js -- passed in so the model doesn't just repeat it.
 */
async function summarize(question, sources, mode = "adult", directAnswer = null) {
  if (!sources || sources.length === 0) {
    return {
      context: "",
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

  const directAnswerBlock = directAnswer
    ? `The user has ALREADY been shown this direct-answer snippet (source [${directAnswer.sourceIndex}]): "${directAnswer.text}"\nDo not repeat this -- add what comes next.\n\n`
    : "";

  const userMessage = `User question: ${question}\n\n${directAnswerBlock}Excerpts:\n${excerptsBlock}`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
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
            context: { type: "string" },
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
          required: ["evidenceNotes", "context", "disagreement", "confidence", "citations"],
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
      context: raw,
      disagreement: "(unparsed model output -- check formatting)",
      confidence: "low",
      evidenceNotes: [],
      citations: [],
    };
  }

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
