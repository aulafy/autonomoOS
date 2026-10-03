import { createEmailTaskBridge } from "./email-task-bridge.js";
import { randomUUID } from "node:crypto";
import type { TaskRuntimeKernel } from "@agent-world/task-runtime";
import type { JournalKernel } from "@agent-world/runtime-store-sqlite";
import { emailHash, type EmailPayload } from "./email-provider.js";
import type { EmailReviewStore, EmailReview } from "./email-review-store.js";
import type { createEmailGovernance } from "./email-governance.js";
/** Product review state is an effect projection, not a second execution engine.
 * M2 runs the host fixture locally and dispatches its only external action through C11. */
export function createEmailWorkflow(
  kernel: TaskRuntimeKernel,
  journal: JournalKernel,
  store: EmailReviewStore,
  governance: ReturnType<typeof createEmailGovernance>,
  payloadFor: (taskId: string) => EmailPayload,
  options:{context?:()=>string;simulated?:boolean;draftFrom?:()=>string;validatePayload?:(payload:unknown)=>EmailPayload}={},
) {
  const busy = new Set<string>(),
    bridge = createEmailTaskBridge(kernel, journal, store);
  bridge.restore(governance.view);
  function task(taskId: string, owner: string) {
    const state = kernel.snapshot(),
      t = state.tasks[taskId];
    if (!t || t.owner !== owner) throw new Error("EMAIL_TASK_NOT_FOUND");
    return { state, t };
  }
  function plan(taskId: string, owner: string) {
    const { state, t } = task(taskId, owner),
      p = state.plans.find(
        (p) => p.taskId === taskId && p.version === t.planVersion,
      );
    if (
      !p ||
      !p.workUnitIds.length ||
      ["cancelled", "failed"].includes(t.status)
    )
      throw new Error("EMAIL_PLAN_NOT_EXECUTABLE");
    const units = p.workUnitIds.map((id) => state.workUnits[id]!);
    const send = units.find((u) =>
      u.requiredCapabilities.some((c) => c.capability === "email.send_reply"),
    );
    const review = units.find((u) =>
      u.requiredCapabilities.some((c) => c.capability === "email.review_reply"),
    );
    if (!send || !review || !send.dependencies.includes(review.id))
      throw new Error("EMAIL_PLAN_REVIEW_REQUIRED");
    const hash = emailHash({
      ...(options.context?{providerContext:options.context()}:{}),
      taskId,
      goal: t.goal,
      owner: t.owner,
      version: p.version,
      units: units.map((u) => ({
        id: u.id,
        title: u.title,
        objective: u.objective,
        dependencies: u.dependencies,
        requiredCapabilities: u.requiredCapabilities,
        constraints: u.constraints,
        expectedArtifacts: u.expectedArtifacts,
        successCriteria: u.successCriteria,
      })),
    });
    return { t, hash, stepId: send.id };
  }
  function current(taskId: string, owner: string): EmailReview {
    const { t, hash, stepId } = plan(taskId, owner),
      r = store.latest(taskId);
    if (
      !r ||
      r.owner !== owner ||
      r.planVersion !== t.planVersion ||
      r.planHash !== hash ||
      r.stepId !== stepId ||
      emailHash(r.payload) !== r.payloadHash
    )
      throw new Error("EMAIL_APPROVAL_STALE");
    return r;
  }
  function saveDraft(taskId:string,owner:string,input:{to:string;subject:string;body:string;contactId:string}){
   if(busy.has(taskId)||!options.draftFrom||!options.validatePayload)throw new Error('EMAIL_DRAFT_NOT_AVAILABLE');plan(taskId,owner);
   const payload=options.validatePayload({from:options.draftFrom(),to:[input.to],cc:[],bcc:[],subject:input.subject,body:input.body,contactId:input.contactId});
   store.saveDraft({taskId,owner,payload,at:Date.now()});return view(taskId,owner);
  }
  async function propose(taskId: string, owner: string) {
    if (busy.has(taskId)) throw new Error("EMAIL_BUSY");
    busy.add(taskId);
    try {
      if (
        ["completed", "unknown", "blocked"].includes(
          task(taskId, owner).t.status,
        )
      )
        throw new Error("EMAIL_TASK_NOT_PREPARABLE");
      const p = plan(taskId, owner),
        previous = store.latest(taskId);
      if (previous && governance.view(previous).length)
        throw new Error("EMAIL_DISPATCH_ALREADY_CLAIMED");
      const draft=store.draft(taskId);if(options.simulated===false&&!draft)throw new Error('GMAIL_DRAFT_REQUIRED');
      const payload = draft?.payload??payloadFor(taskId),
        payloadHash = emailHash(payload);
      bridge.prepare(taskId, payload);
      if (
        previous &&
        previous.planHash === p.hash &&
        previous.payloadHash === payloadHash
      )
        return view(taskId, owner);
      const r = store.propose({
        id: randomUUID(),
        taskId,
        owner,
        planVersion: p.t.planVersion,
        planHash: p.hash,
        stepId: p.stepId,
        payload,
        ...(options.simulated===false?{provider:"gmail-email" as const}:{}),
        at: Date.now(),
      });
      const evaluation = await governance.evaluate(r);
      store.recordPolicy({
        reviewId: r.id,
        composition: evaluation.composition.verdict,
        flow: evaluation.flow.verdict,
        at: Date.now(),
      });
      governance.audit(taskId, "plan.bound", r.planHash);
      governance.audit(taskId, "policy.evaluated", r.bindingHash);
      if (
        evaluation.composition.verdict === "deny" ||
        evaluation.flow.verdict === "deny"
      )
        throw new Error("EMAIL_POLICY_DENIED");
      return view(taskId, owner);
    } finally {
      busy.delete(taskId);
    }
  }
  async function decide(
    taskId: string,
    owner: string,
    input: { bindingHash: string; decision: "approved" | "rejected" },
    mayCommit?: () => boolean,
  ) {
    if (busy.has(taskId)) throw new Error("EMAIL_BUSY");
    busy.add(taskId);
    try {
      const r = current(taskId, owner);
      if (r.bindingHash !== input.bindingHash)
        throw new Error("EMAIL_APPROVAL_STALE");
      if (governance.view(r).length)
        throw new Error("EMAIL_DISPATCH_ALREADY_CLAIMED");
      const previous = store.decision(r.id);
      if (previous) {
        if (previous.decision !== input.decision)
          throw new Error("EMAIL_DECISION_CONFLICT");
        return view(taskId, owner);
      }
      const evaluation = await governance.evaluate(r);
      if (
        evaluation.composition.verdict === "deny" ||
        evaluation.flow.verdict === "deny"
      )
        throw new Error("EMAIL_POLICY_DENIED");
      if (mayCommit && !mayCommit()) throw new Error("EMAIL_AUTH_CHANGED");
      current(taskId, owner);
      const id = randomUUID();
      journal.transaction(() => {
        store.decide({
          id,
          reviewId: r.id,
          bindingHash: r.bindingHash,
          userId: owner,
          at: Date.now(),
          decision: input.decision,
        });
        if (input.decision === "approved") governance.approve(r, id);
        bridge.decision(r, store.decision(r.id)!);
        governance.audit(taskId, `approval.${input.decision}`, id);
      });
      return view(taskId, owner);
    } finally {
      busy.delete(taskId);
    }
  }
  async function execute(
    taskId: string,
    owner: string,
    mayDispatch?: () => boolean,
  ) {
    if (busy.has(taskId)) throw new Error("EMAIL_BUSY");
    busy.add(taskId);
    try {
      const r = current(taskId, owner),
        d = store.decision(r.id);
      if (d?.decision !== "approved" || d.bindingHash !== r.bindingHash)
        throw new Error("EMAIL_APPROVAL_REQUIRED");
      if (mayDispatch && !mayDispatch()) throw new Error("EMAIL_AUTH_CHANGED");
      const effects = governance.view(r);
      if (effects.length) return view(taskId, owner); // Never re-admit or dispatch an existing claim, including UNKNOWN.
      bridge.start(r);
      try {
        await governance.execute(r, d.id, () => {
          current(taskId, owner);
          if (mayDispatch && !mayDispatch())
            throw new Error("EMAIL_AUTH_CHANGED");
        });
      } catch (error) {
        const observed = governance.view(r);
        if (!observed.length) bridge.failAdmission(r);
        else bridge.settle(r, observed);
        throw error;
      }
      bridge.settle(r, governance.view(r));
      return view(taskId, owner);
    } finally {
      busy.delete(taskId);
    }
  }
  async function reconcile(taskId: string, owner: string) {
    task(taskId, owner);
    const r = store.latest(taskId);
    if (!r || r.owner !== owner) throw new Error("EMAIL_TASK_NOT_FOUND");
    if (busy.has(taskId)) throw new Error("EMAIL_BUSY");
    busy.add(taskId);
    try {
      await governance.reconcile(r);
      bridge.settle(r, governance.view(r));
      return view(taskId, owner);
    } finally {
      busy.delete(taskId);
    }
  }
  function view(taskId: string, owner: string) {
    const { t } = task(taskId, owner),
      r = store.latest(taskId);
    if (!r)
      return {
        taskId,
        simulated: options.simulated??true,
        status: "plan_ready",
        review: null,
        draft:store.draft(taskId)?.payload??null,
        effects: [],
        audit: [],
      };
    if (r.owner !== owner) throw new Error("EMAIL_TASK_NOT_FOUND");
    const d = store.decision(r.id),
      effects = governance.view(r),
      policy = store.policy(r.id);
    let stale = false;
    try {
      current(taskId, owner);
    } catch {
      stale = true;
    }
    const state = effects.length
      ? effects.some((e) => e.effective === "unknown")
        ? effects.some((e) =>
            ["dispatching", "prepared", "preparing"].includes(e.status),
          )
          ? "running"
          : "unknown"
        : effects.every((e) => e.effective === "committed")
          ? "completed"
          : "failed"
      : stale ||
          t.status === "blocked" ||
          policy?.composition === "deny" ||
          policy?.flow === "deny"
        ? "blocked"
        : d?.decision === "rejected"
          ? "blocked"
          : d?.decision === "approved"
            ? "approved"
            : "waiting_approval";
    return {
      taskId,
      simulated: r.provider!=="gmail-email",
      status: state,
      review: r,
      decision: d,
      policy,
      effects,
      audit: store.timeline(taskId),
      globalTaskStatus: t.status,
      scope: r.provider==="gmail-email"?"test-preparation-real-email":"simulated-email-workflow",
    };
  }
  return { propose, decide, execute, reconcile, view,saveDraft };
}
export type EmailWorkflowView = ReturnType<
  ReturnType<typeof createEmailWorkflow>["view"]
>;
