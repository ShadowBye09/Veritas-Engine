// ask.js
// Run: node ask.js "is climate change caused by humans" adult
require("dotenv").config();
const { retrieveSources } = require("./retrieve");
const { summarize } = require("./summarize");
const { getCachedResult, setCachedResult } = require("./cache"); // Import cache

async function main() {
  const question = process.argv[2];
  const mode = process.argv[3] === "kid" ? "kid" : "adult";

  if (!question) {
    console.error('Usage: node ask.js "your question" [kid|adult]');
    process.exit(1);
  }

  console.log(`\nQuestion: ${question}  (mode: ${mode})`);

  // --- CACHE CHECK STEP ---
  console.log("Checking cache...");
  const cached = getCachedResult(question, mode, 48); // Cache is valid for 48 hours
  if (cached) {
    console.log("⚡ [Cache Hit] Returning saved answer!");
    printResult(cached);
    return;
  }
  console.log("❄️ [Cache Miss] Fetching fresh data...");

  // --- ORIGINAL API STEP ---
  console.log("Searching whitelist...");
  const sources = await retrieveSources(question);

  if (sources.length === 0) {
    console.log("No sources found in whitelist for this query.\n");
    return;
  }

  console.log(`Found ${sources.length} source(s):`);
  sources.forEach((s) => console.log(`  [${s.index}] ${s.title} -- ${s.link}`));

  console.log("\nSummarizing with grounding constraint...\n");
  const result = await summarize(question, sources, mode);

  // --- SAVE TO CACHE STEP ---
  setCachedResult(question, mode, result);

  printResult(result);
}

// Extracted printer helper to keep code clean
function printResult(result) {
  console.log("\nANSWER:");
  console.log(result.answer);
  console.log("\nDISAGREEMENT:");
  console.log(result.disagreement);
  console.log("\nCONFIDENCE:", result.confidence);
  console.log("\nCITATIONS:");
  console.log(JSON.stringify(result.citations, null, 2));
  console.log("\nSOURCES:");
  console.log(JSON.stringify(result.sources, null, 2));
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});