import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspaceRuntime } from "../src/runtime-source.js";
import { FakeEmailProvider } from "../src/email-provider.js";
import {
  WorkspaceApi,
  InMemoryWorkspaceRepository,
} from "../src/workspace-api.js";
import { parseEmailView } from "../src/email-view.js";
import type { InferenceProvider, ProposedPlan } from "@agent-world/inference";
const provider: InferenceProvider = {
  id: "fixture",
  capabilities: async () => ["structured_output"],
  health: async () => ({
    ok: true,
    provider: "fixture",
    endpoint: "http://127.0.0.1",
    authConfigured: false,
  }),
  proposePlan: async (c) => ({
    plan: {
      actions: c.availableActions.map((action) => ({
        action,
        targetId: c.entities.find((e) => e.affordances.includes(action))!.id,
        parameters: {},
      })),
    } as ProposedPlan,
    rawText: "",
    latencyMs: 0,
  }),
};
async function setup(
  options: ConstructorParameters<typeof FakeEmailProvider>[1] = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "email-product-")),
    mail = new FakeEmailProvider(join(dir, "mail.db"), options),
    runtime = await openWorkspaceRuntime(join(dir, "runtime.db"), "agency", {
      provider,
      emailProvider: mail,
    });
  runtime.source.createTask!("agency", "owner", {
    id: "job",
    goal: "Consulta de seguro",
  });
  await runtime.source.planTask!("agency", "owner", {
    taskId: "job",
    workflow: "email-lead-v1",
  });
  const repository = new InMemoryWorkspaceRepository(),
    api = new WorkspaceApi(repository, undefined, runtime.source);
  for (const [user, role] of [
    ["owner", "owner"],
    ["other", "owner"],
    ["owner-agent", "agent"],
    ["worker", "worker"],
  ] as const)
    api.addSession(user + "-token-123456", {
      userId: user,
      tenantId: "agency",
      role,
    });
  const req = (
    operation = "",
    body?: unknown,
    token = "owner-token-123456",
    method = operation ? "POST" : "GET",
  ) =>
    api.handleAsync({
      method: method as "GET" | "POST",
      path:
        "/v1/workspaces/agency/runtime/job/email" +
        (operation ? "/" + operation : ""),
      authorization: "Bearer " + token,
      body,
    });
  return {
    runtime,
    repository,
    api,
    mail,
    req,
    close: () => {
      runtime.close();
      mail.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("API runs policy -> exact approval -> C11 -> independent observation, durable evidence and no repeat dispatch", async () => {
  const f = await setup();
  try {
    assert.equal((await f.req()).body.status, "plan_ready");
    const review = await f.req("review", {});
    assert.equal(review.status, 200);
    const view = parseEmailView(review.body, "agency", "job");
    assert.equal(view.status, "waiting_approval");
    assert.ok(
      "policy" in view && view.policy?.composition === "require_approval",
    );
    assert.equal((await f.req("execute", {})).status, 409);
    assert.equal(
      (
        await f.req("decision", {
          bindingHash: "f".repeat(64),
          decision: "approved",
        })
      ).status,
      409,
    );
    assert.deepEqual(f.mail.counts(), { sent: 0, calls: 0 });
    const approval = await f.req("decision", {
      bindingHash: view.review!.bindingHash,
      decision: "approved",
    });
    assert.equal(approval.body.status, "approved");
    const sent = await f.req("execute", {});
    assert.equal(sent.body.status, "completed");
    assert.deepEqual(f.mail.counts(), { sent: 1, calls: 1 });
    assert.equal((await f.req("execute", {})).body.status, "completed");
    assert.deepEqual(f.mail.counts(), { sent: 1, calls: 1 });
    const finished = parseEmailView(sent.body, "agency", "job");
    assert.ok(finished.effects[0]?.observationIds.length);
    assert.ok(finished.audit.some((a) => a.type === "plan.bound"));
    assert.ok(finished.audit.some((a) => a.type === "approval.approved"));
    assert.equal(f.runtime.kernel.snapshot().tasks.job!.status, "completed");
    assert.equal(
      Object.values(f.runtime.kernel.snapshot().workUnits).filter(
        (u) => u.status === "succeeded",
      ).length,
      9,
    ); // All local steps have durable simulated evidence.
  } finally {
    f.close();
  }
});
test("rejection is durable, immutable, audited and prevents dispatch", async () => {
  const f = await setup();
  try {
    const r = await f.req("review", {});
    const hash = (r.body.review as { bindingHash: string }).bindingHash;
    assert.equal(
      (await f.req("decision", { bindingHash: hash, decision: "rejected" }))
        .body.status,
      "blocked",
    );
    assert.equal(
      (await f.req("decision", { bindingHash: hash, decision: "approved" }))
        .status,
      409,
    );
    assert.equal((await f.req("execute", {})).status, 409);
    assert.deepEqual(f.mail.counts(), { sent: 0, calls: 0 });
    assert.ok(
      f.runtime.source
        .email!.view("job", "owner")
        .audit.some((a) => a.type === "approval.rejected"),
    );
  } finally {
    f.close();
  }
});
test("ownership, role, tenant, method and session revocation fail before send", async () => {
  const f = await setup();
  try {
    assert.equal((await f.req("review", {}, "other-token-123456")).status, 404);
    assert.equal(
      (await f.req("decision", {}, "owner-agent-token-123456")).status,
      403,
    );
    assert.equal(
      (await f.req("execute", {}, "owner-agent-token-123456")).status,
      403,
    );
    assert.equal(
      (await f.req("", undefined, "worker-token-123456")).status,
      403,
    );
    assert.equal((await f.req("execute", {}, undefined, "GET")).status, 405);
    const r = await f.req("review", {});
    await f.req("decision", {
      bindingHash: (r.body.review as { bindingHash: string }).bindingHash,
      decision: "approved",
    });
    f.repository.revokeSession("owner-token-123456");
    assert.equal((await f.req("execute", {})).status, 401);
    assert.deepEqual(f.mail.counts(), { sent: 0, calls: 0 });
  } finally {
    f.close();
  }
});
test("cancelled job invalidates an otherwise matching approval; explicit certified rejection is FAILED, not UNKNOWN", async () => {
  const f = await setup();
  try {
    const r = await f.req("review", {});
    await f.req("decision", {
      bindingHash: (r.body.review as { bindingHash: string }).bindingHash,
      decision: "approved",
    });
    const s = f.runtime.kernel.snapshot();
    f.runtime.kernel.apply(
      {
        id: "cancel",
        taskId: "job",
        at: Date.now(),
        type: "GlobalTaskCancelled",
      },
      s.revision,
    );
    assert.equal((await f.req()).body.status, "blocked");
    assert.equal((await f.req("execute", {})).status, 409);
    assert.deepEqual(f.mail.counts(), { sent: 0, calls: 0 });
  } finally {
    f.close();
  }
  const g = await setup({ rejectBeforeSend: true });
  try {
    const r = await g.req("review", {});
    await g.req("decision", {
      bindingHash: (r.body.review as { bindingHash: string }).bindingHash,
      decision: "approved",
    });
    assert.equal((await g.req("execute", {})).body.status, "failed");
    assert.deepEqual(g.mail.counts(), { sent: 0, calls: 0 });
  } finally {
    g.close();
  }
});
test("unobserved executor success stays UNKNOWN and read-only reconciliation resolves it", async () => {
  const f = await setup({ hideObservation: true });
  try {
    const r = await f.req("review", {});
    await f.req("decision", {
      bindingHash: (r.body.review as { bindingHash: string }).bindingHash,
      decision: "approved",
    });
    assert.equal((await f.req("execute", {})).body.status, "unknown");
    assert.equal((await f.req("reconcile", {})).body.status, "completed");
    assert.deepEqual(f.mail.counts(), { sent: 1, calls: 1 });
  } finally {
    f.close();
  }
});

test("client keeps unknown future states and rejects foreign or mismatched approval projections", async () => {
  const f = await setup();
  try {
    const result = await f.req("review", {});
    const v = structuredClone(result.body);
    v.status = "future-provider-state";
    assert.equal(
      parseEmailView(v, "agency", "job").status,
      "future-provider-state",
    );
    assert.throws(
      () => parseEmailView(v, "foreign", "job"),
      /INVALID_EMAIL_VIEW/,
    );
    const r = v.review as Record<string, unknown>;
    r.planHash = "short";
    assert.throws(
      () => parseEmailView(v, "agency", "job"),
      /INVALID_EMAIL_VIEW/,
    );
  } finally {
    f.close();
  }
});
