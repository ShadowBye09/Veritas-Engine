// server.js
// Wraps the retrieve -> summarize -> cache pipeline as a live HTTP API.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { retrieveSources, searchWhitelist } = require("./retrieve");
const { summarize } = require("./summarize");
const { getCachedResult, setCachedResult } = require("./cache");
const { findHumanAnswer, reloadHumanAnswers, listLoadedAnswers } = require("./humanAnswers");

const app = express();
app.use(cors());
app.use(express.json());

const CACHE_TTL_HOURS = 48;

/**
 * POST /ask
 * body: { "question": "...", "mode": "adult"|"kid"|"contested", "debias": true|false }
 */
app.post("/ask", async (req, res) => {
  const { question, mode, debias } = req.body || {};

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'question' field" });
  }
  
  const safeMode = ["kid", "adult", "contested"].includes(mode) ? mode : "adult";
  const shouldDebias = !!debias;

  try {
    // Tier 1: Human Answers
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

    // Tier 2: Cached Answers
    // Modify cache key representation so debiased queries don't override standard queries
    const cacheModeKey = `${safeMode}${shouldDebias ? "-debiased" : ""}`;
    const cached = getCachedResult(question, cacheModeKey, CACHE_TTL_HOURS);
    if (cached) {
      return res.json({ tier: "ai", ...cached, cached: true });
    }

    // Tier 3: Fresh AI Pipeline
    const { aiSources, moreSources } = await retrieveSources(question, safeMode, shouldDebias);

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

    // Use contested mode instructions if we successfully split query perspectives
    const activeLLMMode = shouldDebias ? "contested" : safeMode;
    const result = await summarize(question, aiSources, activeLLMMode);
    result.moreSources = moreSources;
    
    setCachedResult(question, cacheModeKey, result);

    return res.json({ tier: "ai", ...result, cached: false });
  } catch (err) {
    console.error("Error in /ask:", err.message);
    return res.status(500).json({ error: "Something went wrong processing this question." });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/more-sources", async (req, res) => {
  const { question, excludeLinks } = req.body || {};

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'question' field" });
  }

  try {
    const results = await searchWhitelist(question);
    const exclude = new Set(excludeLinks || []);
    const filtered = results.filter((r) => !exclude.has(r.link));
    return res.json({ moreSources: filtered });
  } catch (err) {
    console.error("Error in /more-sources:", err.message);
    return res.status(500).json({ error: "Something went wrong fetching more sources." });
  }
});

app.get("/debug/human-answers", (req, res) => {
  res.json(listLoadedAnswers());
});

// Admin hot-reloader
app.post("/admin/reload-answers", (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token !== (process.env.ADMIN_TOKEN || "local_secret_code")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const count = reloadHumanAnswers();
  return res.json({ success: true, message: `Successfully reloaded ${count} human answers.` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Veritas API listening on port ${PORT}`);
});
