// server.js
// Wraps the retrieve -> summarize -> cache pipeline as a live HTTP API,
// so Bubble (or any frontend) can call it over the internet.
//
// Run locally:  node server.js
// Deploy: push this whole folder to Render as a Web Service.
//   Build command: npm install
//   Start command:  node server.js
//   Env vars to set in Render's dashboard: OPENAI_API_KEY, SERPER_API_KEY

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { retrieveSources } = require("./retrieve");
const { summarize } = require("./summarize");
const { getCachedResult, setCachedResult } = require("./cache");
const { findHumanAnswer } = require("./humanAnswers");

const app = express();
app.use(cors()); // allows Bubble's servers to call this API from a browser/backend workflow
app.use(express.json());

const CACHE_TTL_HOURS = 48;

/**
 * POST /ask
 * body: { "question": "is climate change caused by humans", "mode": "adult" }
 *
 * Returns the same shape ask.js prints, as JSON:
 * { answer, disagreement, confidence, citations, sources, cached }
 */
app.post("/ask", async (req, res) => {
  const { question, mode } = req.body || {};

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'question' field" });
  }
  const safeMode = mode === "kid" ? "kid" : "adult";

  try {
    // Tier 1: human-written, two-pass-verified answer. Checked first,
    // always -- this is the highest-trust content on the site and should
    // never be skipped in favor of a fresh AI call.
    const humanAnswer = findHumanAnswer(question);
    if (humanAnswer) {
      return res.json({
        tier: "human",
        answer: humanAnswer[safeMode === "kid" ? "answer_kid" : "answer_adult"],
        disagreement: humanAnswer.disagreement,
        confidence: "high",
        citations: [],
        sources: humanAnswer.sources,
        moreSources: [],
        author: humanAnswer.author,
        reviewedBy: humanAnswer.reviewed_by,
        lastUpdated: humanAnswer.last_updated,
        cached: false,
      });
    }

    // Tier 2: cached AI answer from a previous identical question.
    const cached = getCachedResult(question, safeMode, CACHE_TTL_HOURS);
    if (cached) {
      return res.json({ tier: "ai", ...cached, cached: true });
    }

    // Tier 3: fresh AI pipeline.
    const { aiSources, moreSources } = await retrieveSources(question);

    if (aiSources.length === 0) {
      return res.json({
        tier: "ai",
        answer: "The approved sources don't have enough information to answer this.",
        disagreement: "No sources were found to evaluate.",
        confidence: "low",
        citations: [],
        sources: [],
        moreSources: [],
        cached: false,
      });
    }

    const result = await summarize(question, aiSources, safeMode);
    result.moreSources = moreSources;
    setCachedResult(question, safeMode, result);

    return res.json({ tier: "ai", ...result, cached: false });
  } catch (err) {
    console.error("Error in /ask:", err.message);
    return res.status(500).json({ error: "Something went wrong processing this question." });
  }
});

// Simple health check -- useful for confirming the server is alive after
// deploying, and for Render's health checks if you configure one.
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Veritas API listening on port ${PORT}`);
});
