// summarize.js
// Step 3: feed the retrieved excerpts to an LLM with a hard grounding
// constraint, get back a structured, cited answer.
//
// Configured to use OpenAI's Chat Completions API with gpt-4o-mini.

const OpenAI = require("openai");
const { SYSTEM_PROMPT } = require("./config");

// This automatically pulls process.env.OPENAI_API_KEY
const client = new OpenAI(); 

/**
 * @param {string} question - the user's original question
 * @param {Array} sources - [{ index, title, link, text }] from retrieve.js
 * @param {"kid"|"adult"} mode
 */
async function summarize(question, sources, mode = "adult") {
  if (!sources || sources.length === 0) {
    return {
      answer:
        "The approved sources don't have enough information to answer this.",
      disagreement: "No sources were found to evaluate.",
      confidence: "low",
      citations: [],
    };
  }

  const excerptsBlock = sources
    .map(
      (s) =>
        `[${s.index}] source: ${s.link}\ntitle: ${s.title}\n${s.text}\n`
    )
    .join("\n---\n");

  const userMessage = `User question: ${question}\n\nExcerpts:\n${excerptsBlock}`;

  const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  max_tokens: 1000,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "summarize_response",
      strict: true,
      schema: {
        type: "object",
        properties: {
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
        required: ["answer", "disagreement", "confidence", "citations"],
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
      citations: [],
    };
  }

  // Preserve sources array structure for the final output
  parsed.sources = sources.map((s) => ({
    index: s.index,
    title: s.title,
    link: s.link,
  }));

  return parsed;
}

module.exports = { summarize };