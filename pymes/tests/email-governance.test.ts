import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RuntimeDatabase,
  JournalKernel,
  ReplayClock,
  createDurableDomainStores,
} from "@agent-world/runtime-store-sqlite";
import { EmailReviewStore } from "../src/email-review-store.js";
import { FakeEmailProvider, emailHash } from "../src/email-provider.js";
import { createEmailGovernance } from "../src/email-governance.js";
const payload = {
  from: "office@example.test",
  to: ["client@example.test"],
  cc: [],
  bcc: [],
  subject: "Consulta",
  body: "Respuesta exacta aprobada",
  contactId: "contact",
};
async function open(
  path: string,
  mail: string,
  options: ConstructorParameters<typeof FakeEmailProvider>[1] = {},
) {
  const db = new RuntimeDatabase(path),
    journal = new JournalKernel(db, new ReplayClock()),
    stores = createDurableDomainStores(journal),
    reviews = journal.register("emailReviews", () => new EmailReviewStore(), [
      "propose",
      "decide",
      "audit",
    ]);
  await journal.restore();
  const provider = new FakeEmailProvider(mail, options),
    governance = createEmailGovernance(journal, stores, reviews, provider);
  return {
    db,
    journal,
    stores,
    reviews,
    provider,
    governance,
    close: () => {
      provider.close();
      db.close();
    },
  };
}
test("real C11 requires C8/C9 approval, reserves budget and commits only observed exact email payload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "email-c11-")),
    r = await open(join(dir, "runtime.db"), join(dir, "mail.db"));
  try {
    const review = r.reviews.propose({
      id: "review",
      taskId: "job",
      owner: "owner",
      planVersion: 1,
      planHash: emailHash({ plan: 1 }),
      stepId: "send",
      payload,
      at: Date.now(),
    });
    const evaluation = await r.governance.evaluate(review);
    assert.equal(evaluation.composition.verdict, "require_approval");
    assert.equal(evaluation.flow.verdict, "require_release_approval");
    await assert.rejects(
      r.governance.execute(review, "invented"),
      /EMAIL_APPROVAL_BINDING_DENIED/,
    );
    assert.equal(r.provider.counts().sent, 0);
    r.reviews.decide({
      id: "approval",
      reviewId: review.id,
      bindingHash: review.bindingHash,
      userId: review.owner,
      at: Date.now(),
      decision: "approved",
    });
    r.governance.approve(review, "approval");
    const result = await r.governance.execute(review, "approval");
    assert.equal(result.status, "completed");
    assert.equal(r.provider.counts().sent, 1);
    const effect = r.stores.effects.get(result.effectId!)!;
    assert.equal(effect.status, "committed");
    assert.equal(effect.action, "email.send");
    assert.deepEqual(effect.parameters, payload);
    assert.equal(effect.observationIds.length, 1);
    assert.equal(
      r.stores.budgets.getReservation(effect.budgetReservationIds[0]!)?.status,
      "committed",
    );
    await assert.rejects(r.governance.execute(review, "approval"), /CLAIMED/);
    assert.equal(r.provider.counts().calls, 1);
  } finally {
    r.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("lost receipt is UNKNOWN; durable restart reconciliation confirms mailbox with one send and repairs accounting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "email-unknown-")),
    path = join(dir, "runtime.db"),
    mail = join(dir, "mail.db");
  let r = await open(path, mail, { loseResponse: true });
  try {
    const review = r.reviews.propose({
      id: "review",
      taskId: "job",
      owner: "owner",
      planVersion: 1,
      planHash: emailHash({ plan: 1 }),
      stepId: "send",
      payload,
      at: Date.now(),
    });
    await r.governance.evaluate(review);
    r.reviews.decide({
      id: "approval",
      reviewId: review.id,
      bindingHash: review.bindingHash,
      userId: review.owner,
      at: Date.now(),
      decision: "approved",
    });
    r.governance.approve(review, "approval");
    const result = await r.governance.execute(review, "approval");
    assert.equal(result.status, "unknown");
    assert.equal(r.stores.effects.get(result.effectId!)?.status, "unknown");
    r.close();
    r = await open(path, mail);
    await r.governance.reconcile(review);
    const view = r.governance.view(review)[0]!;
    assert.equal(view.status, "unknown");
    assert.equal(view.effective, "committed");
    assert.equal(view.reconciliations[0]?.outcome, "confirmed_effect");
    assert.deepEqual(r.provider.counts(), { sent: 1, calls: 1 });
    const effect = r.stores.effects.get(view.id)!;
    assert.equal(
      r.stores.budgets.getReservation(effect.budgetReservationIds[0]!)?.status,
      "committed",
    );
  } finally {
    r.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const denial of [
  "revoked-grant",
  "frozen-budget",
  "emergency-stop",
  "mutated-payload",
])
  test(`C11 blocks ${denial} even after exact human approval`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "email-deny-")),
      r = await open(join(dir, "runtime.db"), join(dir, "mail.db"));
    try {
      const review = r.reviews.propose({
        id: "review",
        taskId: "job",
        owner: "owner",
        planVersion: 1,
        planHash: emailHash({ plan: 1 }),
        stepId: "send",
        payload,
        at: Date.now(),
      });
      await r.governance.evaluate(review);
      r.reviews.decide({
        id: "approval",
        reviewId: review.id,
        bindingHash: review.bindingHash,
        userId: review.owner,
        at: Date.now(),
        decision: "approved",
      });
      r.governance.approve(review, "approval");
      const ids = r.governance.identity(review);
      if (denial === "revoked-grant")
        r.stores.grants.revoke(ids.authorityId, 1, Date.now());
      if (denial === "frozen-budget")
        r.stores.budgets.freezeBudget(ids.budgetId, 1);
      if (denial === "emergency-stop")
        r.stores.emergencyStop.activate("operator stop", Date.now());
      if (denial === "mutated-payload")
        review.payload.bcc.push("other@example.test");
      try {
        const result = await r.governance.execute(review, "approval");
        assert.notEqual(result.status, "completed");
      } catch {
        /* Admission may throw or return a denied result; neither can dispatch. */
      }
      assert.deepEqual(r.provider.counts(), { sent: 0, calls: 0 });
      assert.equal(
        r.stores.effects.list().some((e) => e.status === "committed"),
        false,
      );
    } finally {
      r.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
