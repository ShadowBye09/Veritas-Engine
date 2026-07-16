require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { retrieveSources, searchWhitelist } = require("./retrieve");
const { summarize } = require("./summarize");
const { getCachedResult, setCachedResult } = require("./cache");
const { findHumanAnswer, listLoadedAnswers } = require("./humanAnswers");

const app = express();
app.use(cors());
app.use(express.json());

const CACHE_TTL_HOURS = 48;

app.post("/ask", async (req, res) => {
  const { question, mode, debias } = req.body || {};

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'question' field" });
  }
  const safeMode = mode === "kid" ? "kid" : "adult";
  
  // Convert string representations of booleans (e.g. from frontend form values)
  const shouldDebias = debias === true || debias === "true";

  try {
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

    const cacheModeKey = `${safeMode}${shouldDebias ? "-debiased" : ""}`;
    const cached = getCachedResult(question, cacheModeKey, CACHE_TTL_HOURS);
    if (cached) {
      return res.json({ tier: "ai", ...cached, cached: true });
    }

    const { aiSources, moreSources, searchStrategy } = await retrieveSources(question, safeMode, shouldDebias);

    if (aiSources.length === 0) {
      return res.json({
        tier: "ai",
        answer: "The approved sources don't have enough information to answer this.",
        disagreement: "No sources were found to evaluate.",
        confidence: "low",
        citations: [],
        sources: [],
        moreSources: [],
        searchStrategy,
        cached: false,
      });
    }

    const activeLLMMode = searchStrategy.isContested ? "contested" : safeMode;
    const result = await summarize(question, aiSources, activeLLMMode);
    
    result.moreSources = moreSources;
    result.searchStrategy = searchStrategy; 
    
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Veritas API listening on port ${PORT}`);
});
