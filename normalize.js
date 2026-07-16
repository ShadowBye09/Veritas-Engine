// normalize.js
// Single source of truth for turning a user's question into a stable cache
// key. Previously cache.js and volatility.js only did toLowerCase().trim(),
// so "is this real?" and "is this real" were treated as different questions
// and never shared a cache entry -- humanAnswers.js already stripped
// punctuation correctly. Centralizing it here so all three stay in sync.

function normalizeQuestion(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[?.!,]/g, "")
    .replace(/\s+/g, " ");
}

module.exports = { normalizeQuestion };
