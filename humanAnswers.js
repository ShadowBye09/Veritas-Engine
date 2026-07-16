// humanAnswers.js
// Loads every JSON file in /human-answers at startup and matches incoming
// questions against them. This is your highest-trust tier -- checked
// BEFORE the AI pipeline ever runs.
//
// To add a new human-written answer: copy the example file's format, save
// it as a new .json file in /human-answers, and restart the server (or
// call reloadHumanAnswers() if you add a hot-reload trigger later).
// Two-pass verification happens naturally here: have a second person
// review the file via a GitHub pull request before merging it in.

const fs = require("fs");
const path = require("path");
const { normalizeQuestion } = require("./normalize");

const ANSWERS_DIR = path.join(__dirname, "human-answers");

let answerIndex = []; // [{ normalizedQuestions: [...], data: {...} }]

function normalize(str) {
  return normalizeQuestion(str);
}

function loadHumanAnswers() {
  const files = fs
    .readdirSync(ANSWERS_DIR)
    .filter((f) => f.endsWith(".json"));

  answerIndex = files.map((filename) => {
    const raw = fs.readFileSync(path.join(ANSWERS_DIR, filename), "utf-8");
    const data = JSON.parse(raw);

    const allPhrasings = [data.question, ...(data.aliases || [])].map(
      normalize
    );

    return { normalizedQuestions: allPhrasings, data, filename };
  });

  console.log(
    `[humanAnswers] Loaded ${answerIndex.length} human-written answer(s).`
  );
  answerIndex.forEach((entry) => {
    console.log(`  - ${entry.filename}: "${entry.data.question}" (+ ${(entry.data.aliases || []).length} alias(es))`);
  });
}

/**
 * Returns the raw list of loaded answers with their filenames -- useful for
 * a debug endpoint or CLI check to confirm what's actually loaded and what
 * phrasings will match, without guessing.
 */
function listLoadedAnswers() {
  return answerIndex.map((entry) => ({
    filename: entry.filename,
    question: entry.data.question,
    aliases: entry.data.aliases || [],
  }));
}

/**
 * Look for a human-written answer matching the user's question.
 * Matching is intentionally simple and conservative right now: exact match
 * (after normalizing punctuation/case) against the question or any of its
 * aliases. This avoids false-positive matches that could serve the wrong
 * answer to a subtly different question -- a real risk for a fact site.
 * As you get more answers, this is the function to upgrade (e.g. adding
 * fuzzy/embedding-based matching) -- but do that carefully and test it,
 * since looseness here directly trades against accuracy.
 *
 * @param {string} question
 * @returns {object|null} the matched answer's data, or null
 */
function findHumanAnswer(question) {
  const normalizedInput = normalize(question);

  const match = answerIndex.find((entry) =>
    entry.normalizedQuestions.includes(normalizedInput)
  );

  return match ? match.data : null;
}

function reloadHumanAnswers() {
  console.log("Re-scanning the human-answers folder...");
  loadHumanAnswers(); // This runs your folder scanner again
  return answerIndex.length;
}

// Load once at startup.
loadHumanAnswers();

module.exports = { findHumanAnswer, loadHumanAnswers, listLoadedAnswers };
