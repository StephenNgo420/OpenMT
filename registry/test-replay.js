#!/usr/bin/env node
// Offline test: replay known session JSONL files already on disk through
// the parser and assert the resulting events are correct. No live agent
// calls, no DB writes — pure parser verification (Stage 5 plan, step 1).
const fs = require("node:fs");
const { parseLine } = require("./parser");

const FILES = [
  "/home/OpenMT/.openclaw/agents/core/sessions/5a854578-c23b-46cb-9490-9ffcaf0146ca.jsonl",
  "/home/OpenMT/.openclaw/agents/core/sessions/37a6a042-0319-4271-b474-626b92014a10.jsonl",
  "/home/OpenMT/.openclaw/agents/core/sessions/1af1313b-2d78-497f-98a2-6d359448495b.jsonl",
  "/home/OpenMT/.openclaw/agents/finance/sessions/58d99d1d-9867-4075-9fba-bdc1a16c5158.jsonl",
];

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok:", msg);
  }
}

for (const file of FILES) {
  if (!fs.existsSync(file)) {
    console.log("skip (not found):", file);
    continue;
  }
  console.log(`\n--- replaying ${file} ---`);
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const allEvents = [];
  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    allEvents.push(...parseLine(obj));
  }
  console.log(`parsed ${allEvents.length} events:`, allEvents.map((e) => e.type).join(", "));

  const spawnCalls = allEvents.filter((e) => e.type === "spawn_call");
  const spawnResults = allEvents.filter((e) => e.type === "spawn_result");
  const spawnRejections = allEvents.filter((e) => e.type === "spawn_rejected");
  const usageEvents = allEvents.filter((e) => e.type === "usage");
  const finalEvents = allEvents.filter((e) => e.type === "final_assistant");

  assert(usageEvents.every((e) => typeof e.costUsd === "number" && e.costUsd >= 0), "all usage events have a numeric costUsd");
  assert(usageEvents.every((e) => e.provider && e.model), "all usage events have provider+model");

  for (const call of spawnCalls) {
    console.log(`  spawn_call jobId=${call.jobId} prefix=${call.prefix} seq=${call.seq} agentId=${call.agentId}`);
    assert(!!call.jobId, `spawn_call has jobId`);
    assert(call.prefix && call.seq !== null, `jobId "${call.jobId}" parses into prefix/seq`);
    const matchingResult = spawnResults.find((r) => r.toolCallId === call.toolCallId);
    const matchingRejection = spawnRejections.find((r) => r.toolCallId === call.toolCallId);
    assert(!!matchingResult || !!matchingRejection, `spawn_call ${call.jobId} resolves to either a spawn_result or spawn_rejected`);
    if (matchingResult) {
      console.log(`    -> childSessionKey=${matchingResult.childSessionKey}`);
      assert(matchingResult.childSessionKey.startsWith(`agent:${call.agentId}:`), `childSessionKey matches agentId`);
    } else if (matchingRejection) {
      console.log(`    -> rejected: ${matchingRejection.error}`);
    }
  }

  if (finalEvents.length > 0) {
    console.log(`  ${finalEvents.length} final_assistant event(s), last: "${finalEvents[finalEvents.length - 1].text.slice(0, 80)}..."`);
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
