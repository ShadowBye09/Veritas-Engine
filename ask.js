// ask.js
// Run: node ask.js "can we fix climate change" adult debias
require("dotenv").config();
const { retrieveSources } = require("./retrieve");
const { summarize } = require("./summarize");
const { selectDirectAnswer } = require("./directAnswer");
const { findHumanAnswer } = require("./humanAnswers");

async function main() {
  const question = process.argv[2];
  const mode = process.argv[3] === "kid" ? "kid" : "adult";
  const debias = process.argv[4] === "debias" || process.argv[4] === "true";

  if (!question) {
    console.error('Usage: node ask.js "your question" [kid|adult]');
    process.exit(1);
  }

  console.log(`\nQuestion: ${question}  (mode: ${mode})`);

  // Tier 1: Check human-written answers first
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
  // Pass question, mode, AND debias so retrieve.js actually splits the
  // query when requested -- previously this third arg was silently omitted.
  const { aiSources, moreSources, searchStrategy } = await retrieveSources(question, mode, debias);

  if (aiSources.length === 0) {
    console.log("No sources found in whitelist for this query.\n");
    return;
  }

  // Display de-biasing strategy to the user if activated
  if (searchStrategy && searchStrategy.isContested) {
    console.log(`\n=============================================================`);
    console.log(`⚖️  [DE-BIASED ACTIVE] This topic was classified as contested!`);
    console.log(`   We have split your search into balanced perspective queries:`);
    console.log(`   -> Side A: "${searchStrategy.queryA}"`);
    console.log(`   -> Side B: "${searchStrategy.queryB}"`);
    console.log(`=============================================================\n`);
  } else {
    console.log(`\nℹ️  [DIRECT SEARCH] Topic is factual. Single search executed.\n`);
  }

  console.log(`Found ${aiSources.length} AI source(s), ${moreSources.length} extra "read more" link(s):`);
  aiSources.forEach((s) => console.log(`  [${s.index}] ${s.title} -- ${s.link}`));

  console.log("\nSelecting direct-answer snippet...");
  const directAnswer = await selectDirectAnswer(question, aiSources);

  console.log("\nWriting context with grounding constraint...\n");

  // Use contested mode instructions if the query partition was triggered
  const activeLLMMode = (searchStrategy && searchStrategy.isContested) ? "contested" : mode;
  const result = await summarize(question, aiSources, activeLLMMode, directAnswer);

  console.log("DIRECT ANSWER:");
  if (directAnswer) {
    console.log(`"${directAnswer.text}"`);
    console.log(`-- [${directAnswer.sourceIndex}] ${directAnswer.title} (tier ${directAnswer.tier}, match ${directAnswer.matchScore})`);
  } else {
    console.log("(no confident snippet match found)");
  }
  console.log("\nCONTEXT:");
  console.log(result.context);
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
