import { writeFileSync } from "node:fs";
import { RuntimeDatabase, JournalKernel, ReplayClock, createDurableTaskRuntime } from "../../src/index.js";
import type { TaskRuntimeEvent } from "@agent-world/task-runtime";
const [phase, path, output] = process.argv.slice(2);
if (!path || !output) throw new Error("ARGUMENTS_REQUIRED");
const database = new RuntimeDatabase(path);
const journal = new JournalKernel(database, new ReplayClock(() => 100));
const tasks = createDurableTaskRuntime(journal);
await journal.restore();
if (phase === "write") {
  let sequence = 0;
  const send = (payload: Record<string, unknown>) => tasks.apply({ id: `e${++sequence}`, taskId: "task", at: sequence, ...payload } as TaskRuntimeEvent, tasks.snapshot().revision);
  const criteria = [{ id: "check", kind: "custom", input: null, verifierId: "host:check" }];
  send({ type: "GlobalTaskCreated", goal: "Recover without duplicate dispatch", owner: "owner", successCriteria: criteria });
  send({ type: "GlobalTaskPlanningStarted" });
  send({ type: "PlanCommitted", planVersion: 1, workUnits: [
    { id: "w1", title: "Implement", objective: "Modify fixture", dependencies: [], requiredCapabilities: [{ capability: "code.modify_repo" }], constraints: [], expectedArtifacts: [], successCriteria: criteria },
    { id: "w2", title: "Verify", objective: "Run tests", dependencies: ["w1"], requiredCapabilities: [{ capability: "test.run" }], constraints: [], expectedArtifacts: [], successCriteria: criteria }
  ] });
  send({ type: "AttemptCreated", workUnitId: "w1", attemptId: "a1", providerId: "orca", actorId: "codex", dispatchFingerprint: "stable-dispatch" });
  send({ type: "AttemptReserved", attemptId: "a1" });
  send({ type: "AttemptDispatchStarted", attemptId: "a1" });
  send({ type: "AttemptDispatched", attemptId: "a1", providerRef: { provider: "orca", externalRunId: "run1", externalTaskId: "provider-task", externalAttemptId: "dispatch1" } });
  send({ type: "DecisionRecorded", referenceId: "routing-decision", attemptId: "a1" });
  send({ type: "EvidenceRecorded", referenceId: "receipt", attemptId: "a1" });
  send({ type: "AttemptUnknown", attemptId: "a1" });
  send({ type: "ProviderQuestionReceived", attemptId: "a1", providerId: "orca", providerMessageId: "question1", contentRef: "orca-cache:question1" });
  send({ type: "ProviderEscalationReceived", attemptId: "a1", providerId: "orca", providerMessageId: "escalation1", contentRef: "orca-cache:escalation1" });
  writeFileSync(output, JSON.stringify(tasks.snapshot()));
  process.kill(process.pid, "SIGKILL");
} else {
  writeFileSync(output, JSON.stringify(tasks.snapshot()));
  try {
    tasks.apply({ id: "unsafe-retry", taskId: "task", at: 101, type: "AttemptCreated", workUnitId: "w1", attemptId: "a2", providerId: "orca", actorId: "codex", dispatchFingerprint: "new" }, tasks.snapshot().revision);
    throw new Error("UNSAFE_RETRY_ACCEPTED");
  } catch (error) { if (!(error instanceof Error) || error.message !== "WORK_UNIT_NOT_READY") throw error; }
  database.close();
}
