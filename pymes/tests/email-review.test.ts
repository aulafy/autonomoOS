import test from "node:test";
import assert from "node:assert/strict";
import { EmailReviewStore } from "../src/email-review-store.js";
import { emailHash, FakeEmailProvider } from "../src/email-provider.js";
import {
  RuntimeDatabase,
  JournalKernel,
  ReplayClock,
} from "@agent-world/runtime-store-sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const payload = {
  from: "office@example.test",
  to: ["client@example.test"],
  cc: [],
  bcc: [],
  subject: "Consulta",
  body: "Gracias por su consulta.",
  contactId: "contact-fixture",
};
const review = {
  id: "review",
  taskId: "job",
  owner: "owner",
  planVersion: 1,
  planHash: emailHash({ version: 1, steps: ["review", "send"] }),
  stepId: "send",
  payload,
  at: 1,
};
test("approval binds all payload fields and plan version; foreign, mutated and superseded approvals fail closed", () => {
  const store = new EmailReviewStore(),
    r = store.propose(review);
  assert.throws(() =>
    store.decide({
      id: "d",
      reviewId: r.id,
      bindingHash: r.bindingHash,
      userId: "foreign",
      at: 2,
      decision: "approved",
    }),
  );
  for (const changed of [
    { ...review, planVersion: 2 },
    { ...review, payload: { ...payload, body: "Changed" } },
    { ...review, payload: { ...payload, to: ["other@example.test"] } },
    { ...review, payload: { ...payload, bcc: ["hidden@example.test"] } },
  ]) {
    const other = new EmailReviewStore().propose(changed);
    assert.notEqual(other.bindingHash, r.bindingHash);
  }
  store.propose({
    ...review,
    id: "new",
    payload: { ...payload, subject: "Changed" },
  });
  assert.throws(
    () =>
      store.decide({
        id: "d",
        reviewId: r.id,
        bindingHash: r.bindingHash,
        userId: "owner",
        at: 2,
        decision: "approved",
      }),
    /SUPERSEDED/,
  );
});
test("review, rejection and audit survive SQLite reopen and rejection cannot turn into approval", async () => {
  const dir = mkdtempSync(join(tmpdir(), "email-review-"));
  let db = new RuntimeDatabase(join(dir, "runtime.db"));
  try {
    let journal = new JournalKernel(db, new ReplayClock());
    let store = journal.register("emailReviews", () => new EmailReviewStore(), [
      "propose",
      "decide",
      "audit",
    ]);
    await journal.restore();
    const r = store.propose(review);
    store.decide({
      id: "d",
      reviewId: r.id,
      bindingHash: r.bindingHash,
      userId: "owner",
      at: 2,
      decision: "rejected",
    });
    store.audit({
      id: "a",
      taskId: "job",
      type: "rejected",
      at: 2,
      reference: "d",
    });
    db.close();
    db = new RuntimeDatabase(join(dir, "runtime.db"));
    journal = new JournalKernel(db, new ReplayClock());
    store = journal.register("emailReviews", () => new EmailReviewStore(), [
      "propose",
      "decide",
      "audit",
    ]);
    await journal.restore();
    assert.equal(store.decision(r.id)?.decision, "rejected");
    assert.equal(store.timeline("job").length, 1);
    assert.throws(
      () =>
        store.decide({
          id: "d2",
          reviewId: r.id,
          bindingHash: r.bindingHash,
          userId: "owner",
          at: 3,
          decision: "approved",
        }),
      /CONFLICT/,
    );
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("simulated email records send before losing receipt; reopening observes exact approved payload without resending", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fake-email-")),
    path = join(dir, "mail.db"),
    key = emailHash({ operation: "send" });
  let p = new FakeEmailProvider(path, { loseResponse: true });
  try {
    await assert.rejects(
      p.send(payload, key, new AbortController().signal),
      /RESPONSE_LOST/,
    );
    assert.deepEqual(p.counts(), { sent: 1, calls: 1 });
    p.close();
    p = new FakeEmailProvider(path);
    assert.equal(
      (await p.reconcile(key, new AbortController().signal))?.payloadHash,
      emailHash(payload),
    );
    assert.deepEqual(p.counts(), { sent: 1, calls: 1 });
    assert.throws(
      () => p.prepare({ ...payload, to: ["real@gmail.com"] }),
      /SCOPE_DENIED/,
    );
  } finally {
    p.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
