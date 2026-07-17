// cache.js
const Database = require("better-sqlite3");
const path = require("path");
const { normalizeQuestion } = require("./normalize");

// Open or create a local database file named 'veritas_cache.db'
const dbPath = path.join(__dirname, "veritas_cache.db");
const db = new Database(dbPath);

// Enable performance optimizations for SQLite
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Create the cache table if it doesn't already exist
db.exec(`
  CREATE TABLE IF NOT EXISTS query_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    mode TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(question, mode)
  )
`);

// Remembers how "volatile" a given question's topic is, so we don't have to
// re-classify it every time it's asked. This is what lets the shared cache
// use a longer TTL for stable facts and a short one for fast-changing topics
// instead of one flat TTL for everything.
db.exec(`
  CREATE TABLE IF NOT EXISTS topic_volatility (
    question TEXT PRIMARY KEY,
    tier TEXT NOT NULL,
    ttl_hours INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

/**
 * Retrieve cached results if they are newer than the specified TTL (Time-To-Live).
 * @param {string} question 
 * @param {"kid"|"adult"} mode 
 * @param {number} ttlHours - How long the cache is valid (default: 48 hours)
 * @returns {object|null} The cached JSON result or null if expired/not found
 */
function getCachedResult(question, mode, ttlHours = 48) {
  const normalizedQuestion = normalizeQuestion(question);
  
  const query = db.prepare(`
    SELECT result_json 
    FROM query_cache 
    WHERE question = ? AND mode = ? 
    AND datetime(created_at, ?) >= datetime('now')
  `);
  
  // datetime('now') is compared against created_at + TTL hours
  const row = query.get(normalizedQuestion, mode, `+${ttlHours} hours`);
  
  if (row) {
    return JSON.parse(row.result_json);
  }
  return null;
}

/**
 * Save a search & summary result to the cache.
 * @param {string} question 
 * @param {"kid"|"adult"} mode 
 * @param {object} result - The final parsed result object
 */
function setCachedResult(question, mode, result) {
  const normalizedQuestion = normalizeQuestion(question);
  const jsonString = JSON.stringify(result);

  const insert = db.prepare(`
    INSERT INTO query_cache (question, mode, result_json, created_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(question, mode) DO UPDATE SET
      result_json = excluded.result_json,
      created_at = datetime('now')
  `);

  insert.run(normalizedQuestion, mode, jsonString);
}

/**
 * Look up a previously-computed volatility classification for this question.
 * @param {string} question
 * @returns {{tier: string, ttlHours: number}|null}
 */
function getVolatility(question) {
  const normalizedQuestion = normalizeQuestion(question);
  const row = db
    .prepare(`SELECT tier, ttl_hours FROM topic_volatility WHERE question = ?`)
    .get(normalizedQuestion);
  return row ? { tier: row.tier, ttlHours: row.ttl_hours } : null;
}

/**
 * Store a volatility classification so future requests for the same
 * question skip re-classification. Volatility itself doesn't need a TTL --
 * "how fast does this type of topic change" is a stable judgment about the
 * question, not about the answer.
 * @param {string} question
 * @param {string} tier - "FAST" | "MEDIUM" | "SLOW"
 * @param {number} ttlHours
 */
function setVolatility(question, tier, ttlHours) {
  const normalizedQuestion = normalizeQuestion(question);
  db.prepare(`
    INSERT INTO topic_volatility (question, tier, ttl_hours)
    VALUES (?, ?, ?)
    ON CONFLICT(question) DO UPDATE SET
      tier = excluded.tier,
      ttl_hours = excluded.ttl_hours
  `).run(normalizedQuestion, tier, ttlHours);
}

/**
 * Force-expire a specific cached question/mode immediately, regardless of
 * TTL. Manual safety valve for the shared cache -- use when a human notices
 * a cached answer is wrong or stale.
 * @param {string} question
 * @param {string} mode
 * @returns {boolean} true if a row was deleted
 */
function invalidateCachedResult(question, mode) {
  const normalizedQuestion = normalizeQuestion(question);
  const result = db
    .prepare(`DELETE FROM query_cache WHERE question = ? AND mode = ?`)
    .run(normalizedQuestion, mode);
  return result.changes > 0;
}

module.exports = {
  getCachedResult,
  setCachedResult,
  getVolatility,
  setVolatility,
  invalidateCachedResult,
};
