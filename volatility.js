// volatility.js
// Classifies a question by how quickly its correct answer could realistically
// change, so the shared cache can use a longer TTL for stable facts and a
// short one for fast-moving topics -- instead of one flat TTL for everything.

const OpenAI = require("openai");
const { getVolatility, setVolatility } = require("./cache");

let openai;
function getOpenAI() {
  if (!openai) openai = new OpenAI();
  return openai;
}

// Hours to cache a result once we know its volatility tier.
const TTL_HOURS_BY_TIER = {
  FAST: 6,      // breaking news, current officeholders, prices, live events
  MEDIUM: 48,   // scientific consensus, ongoing research, periodic stats
  SLOW: 720,    // historical facts, definitions, settled/completed events
};

const DEFAULT_TIER = "MEDIUM";

const SYSTEM_PROMPT = `You classify how quickly the CORRECT answer to a question could
realistically change over time. Respond with exactly one word:

FAST -- breaking news, current prices/markets, who currently holds a role or
  office, live/ongoing events, anything that could be different tomorrow.
MEDIUM -- scientific or medical consensus, ongoing research areas, statistics
  that get periodically updated (e.g. population, unemployment rate), topics
  where expert understanding evolves over months/years.
SLOW -- historical facts, definitions, completed/settled past events, things
  that are true regardless of when you check.

Respond with ONLY the single word FAST, MEDIUM, or SLOW. No punctuation, no explanation.`;

/**
 * Classify a question's volatility, using a cached classification if we've
 * seen this exact question before so we're not paying for this on every
 * request -- "how fast does this type of topic change" is a stable judgment
 * about the question itself, not about the answer's content.
 *
 * @param {string} question
 * @returns {Promise<{tier: string, ttlHours: number}>}
 */
async function classifyVolatility(question) {
  const cached = getVolatility(question);
  if (cached) {
    return cached;
  }

  let tier = DEFAULT_TIER;
  try {
    // Cheap model -- this is a one-word classification task, not synthesis.
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
      max_tokens: 5,
    });

    const raw = (response.choices[0]?.message?.content || "").trim().toUpperCase();
    if (raw.includes("FAST")) tier = "FAST";
    else if (raw.includes("SLOW")) tier = "SLOW";
    else tier = "MEDIUM";
  } catch (err) {
    console.warn("Volatility classification failed, defaulting to MEDIUM:", err.message);
    tier = DEFAULT_TIER;
  }

  const ttlHours = TTL_HOURS_BY_TIER[tier];
  setVolatility(question, tier, ttlHours);
  return { tier, ttlHours };
}

module.exports = { classifyVolatility, TTL_HOURS_BY_TIER };
