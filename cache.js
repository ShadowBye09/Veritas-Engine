// cache.js
const Database = require("better-sqlite3");
const path = require("path");

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

/**
 * Retrieve cached results if they are newer than the specified TTL (Time-To-Live).
 * @param {string} question 
 * @param {"kid"|"adult"} mode 
 * @param {number} ttlHours - How long the cache is valid (default: 48 hours)
 * @returns {object|null} The cached JSON result or null if expired/not found
 */
function getCachedResult(question, mode, ttlHours = 48) {
  const normalizedQuestion = question.toLowerCase().trim();
  
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
  const normalizedQuestion = question.toLowerCase().trim();
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

module.exports = {
  getCachedResult,
  setCachedResult
};