import { openWorkspaceRuntime } from "../../src/runtime-source.js";
import { FakeEmailProvider } from "../../src/email-provider.js";
import type { InferenceProvider, ProposedPlan } from "@agent-world/inference";
const [path, phase] = process.argv.slice(2);
setInterval(() => {}, 1000);
function stop(name: string) {
  process.send?.(name);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
const provider: InferenceProvider = {
  id: "fixture-local",
  capabilities: async () => ["structured_output"],
  health: async () => ({
    ok: true,
    provider: "fixture-local",
    endpoint: "http://127.0.0.1",
    authConfigured: false,
  }),
  proposePlan: async (context) => ({
    plan: {
      actions: context.availableActions.map((action) => ({
        action,
        targetId: context.entities.find((e) => e.affordances.includes(action))!
          .id,
        parameters: {},
      })),
    } as ProposedPlan,
    rawText: "",
    latencyMs: 0,
  }),
};
const mail = new FakeEmailProvider(path + ".fake-email.db", {
  loseResponse: phase === "lost-response",
  afterSend: () => {
    if (phase === "after-side-effect") stop(phase);
  },
});
const runtime = await openWorkspaceRuntime(path!, "agency", {
  provider,
  emailProvider: mail,
  emailHooks: {
    beforeDispatch: () => {
      if (phase === "before-dispatch") stop(phase);
    },
    afterDispatchMarker: () => {
      if (phase === "during-effect") stop(phase);
    },
  },
});
runtime.source.createTask!("agency", "owner", {
  id: "job",
  goal: "QA email workflow",
});
await runtime.source.planTask!("agency", "owner", {
  taskId: "job",
  workflow: "email-lead-v1",
});
const review = await runtime.source.email!.propose("job", "owner");
await runtime.source.email!.decide("job", "owner", {
  bindingHash: review.review!.bindingHash,
  decision: "approved",
});
if (phase === "after-approval") stop(phase);
await runtime.source.email!.execute("job", "owner");
if (phase === "lost-response") stop(phase);
throw new Error("CRASH_POINT_NOT_REACHED");
