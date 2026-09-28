import { makeDemoData } from "./fixtures.js";
import { classifyDemoText } from "./local-classifier.js";

const messageId = process.argv[2];
const fixture = makeDemoData(new Date("2026-09-28T07:00:00Z"));
const message = fixture.messages.find(item => item.id === messageId);
if (!message || message.classificationSource !== "demo_fixture") {
  process.stderr.write("USAGE: pilot:classify -- <demo-message-id> (msg-1 ... msg-8)\n");
  process.exitCode = 1;
} else {
  try {
    const result = await classifyDemoText({ text: message.text,
      model: process.env.PYMES_LOCAL_MODEL ?? undefined });
    process.stdout.write(JSON.stringify({ messageId: message.id, fixtureOnly: true,
      proposed: result.proposal, model: result.model,
      latencyMs: result.latencyMs, accepted: false }) + "\n");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "LOCAL_CLASSIFIER_FAILED"}\n`);
    process.exitCode = 1;
  }
}
