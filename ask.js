// ask.js
// Run: node ask.js "is climate change caused by humans" adult
require("dotenv").config();
const { retrieveSources } = require("./retrieve");
const { summarize } = require("./summarize");
const { findHumanAnswer } = require("./humanAnswers");

async function main() {
  const question = process.argv[2];
  const mode = process.argv[3] === "kid" ? "kid" : "adult";

  if (!question) {
    console.error('Usage: node ask.js "your question" [kid|adult]');
    process.exit(1);
  }

  console.log(`\nQuestion: ${question}  (mode: ${mode})`);

  // Tier 1: check human-written answers first, same as server.js does.
  console.log("Checking human-written answers...");
  const humanAnswer = findHumanAnswer(question);
  if (humanAnswer) {
    console.log("\n[HUMAN-WRITTEN ANSWER FOUND]\n");
    console.log("ANSWER:");
    console.log(humanAnswer[mode === "kid" ? "answer_kid" : "answer_adult"]);
    console.log("\nDISAGREEMENT:");
    console.log(humanAnswer.disagreement);
    console.log("\nAUTHOR:", humanAnswer.author, "  REVIEWED BY:", (humanAnswer.reviewed_by || []).join(", "));
    console.log("\nSOURCES:");
    console.log(JSON.stringify(humanAnswer.sources, null, 2));
    return;
  }
  console.log("No human-written match -- falling through to AI pipeline.\n");

  console.log("Searching whitelist...");
  const { aiSources, moreSources } = await retrieveSources(question);

  if (aiSources.length === 0) {
    console.log("No sources found in whitelist for this query.\n");
    return;
  }

  console.log(`Found ${aiSources.length} AI source(s), ${moreSources.length} extra "read more" link(s):`);
  aiSources.forEach((s) => console.log(`  [${s.index}] ${s.title} -- ${s.link}`));

  console.log("\nSummarizing with grounding constraint...\n");
  const result = await summarize(question, aiSources, mode);

  console.log("ANSWER:");
  console.log(result.answer);
  console.log("\nDISAGREEMENT:");
  console.log(result.disagreement);
  console.log("\nCONFIDENCE:", result.confidence);
  console.log("\nCITATIONS:");
  console.log(JSON.stringify(result.citations, null, 2));
  console.log("\nSOURCES:");
  console.log(JSON.stringify(result.sources, null, 2));
  console.log("\nEXTRA READ-MORE LINKS:");
  console.log(JSON.stringify(moreSources, null, 2));
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
