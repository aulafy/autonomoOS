import assert from "node:assert/strict";
import test from "node:test";
import { SessionContractSchema } from "../src/contract.js";

import type { ActionIntent } from "@agent-world/protocol";
import {
  ContractValidator,
  InMemoryContractStore,
  type SessionContract
} from "../src/index.js";

function makeContract(
  overrides: Partial<SessionContract> = {}
): SessionContract {
  return {
    id: "contract-1",
    ownerPrincipalId: "human:owner",
    taskId: "task-1",
    objective: "Go to the meeting room and say you are ready.",
    acceptanceCriteria: [
      "Astra is at meeting_room.",
      "Astra said she is ready."
    ],
    forbiddenEffects: ["purchase_compute"],
    allowedResourceIds: ["place:demo-office/meeting-room", "place:demo-office/home-point"],
    maxRisk: "R2",
    privacyClass: "local_only",
    createdAt: 1_000,
    version: 1,
    status: "active",
    metadata: {},
    ...overrides
  };
}

function makeIntent(
  overrides: Partial<ActionIntent> = {}
): ActionIntent {
  return {
    id: "intent-1",
    actorId: "astra",
    action: "goto",
    targetId: "place:demo-office/meeting-room",
    provenance: {
      source: "model",
      taskId: "task-1"
    },
    ...overrides
  } as ActionIntent;
}

test("store binds at most one active contract to a task", async () => {
  const store = new InMemoryContractStore();

  await store.create(makeContract());

  await assert.rejects(
    () => store.create(makeContract({ id: "contract-2" })),
    /already has active contract/
  );
});

test("contract scope rejects legacy aliases and stores canonical IDs", () => {
  assert.equal(SessionContractSchema.safeParse(makeContract()).success, true);
  assert.equal(SessionContractSchema.safeParse(makeContract({
    allowedResourceIds: ["meeting_room"]
  })).success, false);
});

test("store returns defensive copies", async () => {
  const store = new InMemoryContractStore();
  await store.create(makeContract());

  const first = await store.get("contract-1");
  assert.ok(first);
  first.objective = "mutated outside store";

  const second = await store.get("contract-1");
  assert.equal(
    second?.objective,
    "Go to the meeting room and say you are ready."
  );
});

test("replanning cannot change objective", () => {
  const validator = new ContractValidator();
  const contract = makeContract();

  const result = validator.validateReplan(contract, {
    objective: "Email the report to a third party.",
    acceptanceCriteria: [...contract.acceptanceCriteria]
  });

  assert.equal(result.allowed, false);
});

test("replanning cannot change acceptance criteria", () => {
  const validator = new ContractValidator();
  const contract = makeContract();

  const result = validator.validateReplan(contract, {
    objective: contract.objective,
    acceptanceCriteria: ["Something easier happened."]
  });

  assert.equal(result.allowed, false);
});

test("expired deadline blocks execution", () => {
  const validator = new ContractValidator();
  const contract = makeContract({ deadlineAt: 2_000 });

  const result = validator.validateIntent(
    contract,
    makeIntent(),
    "R1",
    2_001
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /deadline/i);
});

test("forbidden effect is denied", () => {
  const validator = new ContractValidator();
  const contract = makeContract();

  const result = validator.validateIntent(
    contract,
    makeIntent({
      action: "purchase_compute",
      targetId: undefined
    }),
    "R2",
    1_100
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /forbidden/i);
});

test("action cannot exceed contract risk ceiling", () => {
  const validator = new ContractValidator();
  const contract = makeContract({ maxRisk: "R1" });

  const result = validator.validateIntent(
    contract,
    makeIntent(),
    "R2",
    1_100
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /risk/i);
});

test("resource scope is enforced", () => {
  const validator = new ContractValidator();
  const contract = makeContract();

  const result = validator.validateIntent(
    contract,
    makeIntent({ targetId: "roof" }),
    "R1",
    1_100
  );

  assert.equal(result.allowed, false);
  assert.match(result.reason, /resource scope/i);
});

test("compatible replan is accepted", () => {
  const validator = new ContractValidator();
  const contract = makeContract();

  const result = validator.validateReplan(contract, {
    objective: contract.objective,
    acceptanceCriteria: [...contract.acceptanceCriteria],
    forbiddenEffects: [...contract.forbiddenEffects, "delegate"],
    allowedResourceIds: ["place:demo-office/meeting-room"],
    maxRisk: "R1",
    privacyClass: "local_only"
  });

  assert.equal(result.allowed, true);
});
