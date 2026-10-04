import { defineEmailLeadUnits } from "./job-planner.js";
import { randomUUID } from "node:crypto";
import type {
  TaskRuntimeKernel,
  TaskRuntimeEvent,
  WorkUnit,
} from "@agent-world/task-runtime";
import type { JournalKernel } from "@agent-world/runtime-store-sqlite";
import type {
  EmailReviewStore,
  EmailReview,
  EmailDecision,
} from "./email-review-store.js";
import { emailHash, type EmailPayload } from "./email-provider.js";
/** Host verification of LOCAL SIMULATION artifacts. Never reports real CRM work.
 * External dispatch is exclusively C11; this adapter projects its evidence into AW2. */
type Command<T = TaskRuntimeEvent> = T extends TaskRuntimeEvent
  ? Omit<T, "id" | "taskId" | "at">
  : never;
export function createEmailTaskBridge(
  kernel: TaskRuntimeKernel,
  journal: JournalKernel,
  store: EmailReviewStore,
  crm?:import('./crm-service.js').CrmWorkflowAdapter,
  sourceFor?:(taskId:string)=>import('./mail-task-contract.js').MailTaskBinding|null,
) {
  function apply(taskId: string, event: Command) {
    const state = kernel.snapshot();
    kernel.apply(
      {
        id: randomUUID(),
        taskId,
        at: Math.max(Date.now(), state.tasks[taskId]!.updatedAt),
        ...event,
      } as TaskRuntimeEvent,
      state.revision,
    );
  }
  const units = (taskId: string) => {
    const s = kernel.snapshot(),
      t = s.tasks[taskId]!;
    return s.plans
      .find((p) => p.taskId === taskId && p.version === t.planVersion)!
      .workUnitIds.map((id) => s.workUnits[id]!);
  };
  function begin(unit: WorkUnit, fingerprint: string,providerId="m2-local-simulation") {
    const current = kernel.snapshot().workUnits[unit.id]!;
    if (current.activeAttemptId) return current.activeAttemptId;
    if (current.status === "succeeded") return current.attemptIds.at(-1)!;
    const attemptId = randomUUID();
    apply(unit.taskId, {
      type: "AttemptCreated",
      workUnitId: unit.id,
      attemptId,
      providerId,
      actorId: kernel.snapshot().tasks[unit.taskId]!.owner,
      dispatchFingerprint: fingerprint,
    });
    apply(unit.taskId, { type: "AttemptReserved", attemptId });
    apply(unit.taskId, { type: "AttemptDispatchStarted", attemptId });
    return attemptId;
  }
  function evidence(
    taskId: string,
    attemptId: string | undefined,
    value: Record<string, unknown>,
  ) {
    const record = store.recordArtifact({
      id: randomUUID(),
      taskId,
      attemptId: attemptId ?? null,
      simulated: !(String(value.kind).startsWith("crm-local-")||['reviewed-mail-recipient','reviewed-mail-classification','reviewed-mail-draft','reviewed-mail-human-review'].includes(String(value.kind))||['governed-email-proof','reviewed-mail-workflow-verified'].includes(String(value.kind))&&value.provider==="gmail-email"),
      value,
      hash: emailHash(value),
      at: Date.now(),
    });
    apply(taskId, {
      type: "EvidenceRecorded",
      referenceId: record.id,
      ...(attemptId ? { attemptId } : {}),
    });
    return record.id;
  }
  function finish(
    unit: WorkUnit,
    attemptId: string,
    value: Record<string, unknown>,
    status: "satisfied" | "unsatisfied" = "satisfied",
  ) {
    const a = kernel.snapshot().attempts[attemptId]!;
    if (a.status === "succeeded" || a.status === "failed") return;
    const ref = evidence(unit.taskId, attemptId, value);
    if (a.status === "unknown")
      apply(unit.taskId, {
        type: "ReconciliationCompleted",
        attemptId,
        evidenceRefs: [ref],
        outcome: "reported-success",
      });
    else if (a.status === "dispatching" || a.status === "running")
      apply(unit.taskId, {
        type: "AttemptProviderReported",
        attemptId,
        outcome: status === "satisfied" ? "succeeded" : "failed",
      });
    if (kernel.snapshot().attempts[attemptId]!.status === "reported")
      apply(unit.taskId, { type: "VerificationStarted", attemptId });
    apply(unit.taskId, {
      type: "VerificationCompleted",
      attemptId,
      results: unit.successCriteria.map((c) => ({
        criterionId: c.id,
        status,
        evidenceRefs: [ref],
      })),
    });
  }
  function local(unit: WorkUnit, value: Record<string, unknown>) {
    if (kernel.snapshot().workUnits[unit.id]!.status === "succeeded") return;
    const attempt = begin(unit, emailHash(value),String(value.kind).startsWith("crm-local-")?"p05-local-crm":String(value.kind).startsWith('reviewed-mail-')?'p07-reviewed-mail':'m2-local-simulation');
    finish(unit, attempt, value);
  }
  function prepare(taskId: string, payload: EmailPayload) {
    journal.transaction(() => {
      const u = units(taskId),
        t = kernel.snapshot().tasks[taskId]!,
        expected = defineEmailLeadUnits({
          ...t,
          planVersion: t.planVersion - 1,
        });
      if (
        emailHash(
          u.map((v) => ({
            id: v.id,
            title: v.title,
            objective: v.objective,
            dependencies: v.dependencies,
            requiredCapabilities: v.requiredCapabilities,
            constraints: v.constraints,
            expectedArtifacts: v.expectedArtifacts,
            successCriteria: v.successCriteria,
          })),
        ) !== emailHash(expected)
      )
        throw new Error("M2_SIMULATION_PLAN_REQUIRED");
      const real=crm?.prepare(taskId,t.owner,payload,t.goal);
      const source=sourceFor?.(taskId);
      if(source&&!real)throw new Error('MAIL_TASK_CRM_PROOF_REQUIRED');
      const values = [
        { kind: source?'reviewed-mail-recipient':real?"crm-local-recipient":"identified-simulated-sender", address: payload.to[0]!,...(source?{accountRef:source.accountRef,gmailId:source.gmailId,sourceHash:source.sourceHash,contactId:source.contactId,reviewed:true}:{}) },
        {
          kind: real?"crm-local-lookup":"simulated-crm-lookup",
          contactId: payload.contactId,
          found: true,
        },
        {
          kind: real?"crm-local-lead":"simulated-lead-proposal",
          contactId: payload.contactId,
          created: !!real?.leadId,
          ...(real?{leadId:real.leadId}:{reason:"Fixture contact already exists"}),
        },
        {
          kind: source?'reviewed-mail-classification':"simulated-classification",
          ...(source?{proposalId:source.proposalId,proposalHash:source.proposalHash,sourceHash:source.sourceHash,provider:source.provider,model:source.model,topic:source.topic,line:source.line,priority:source.priority}:{category:"insurance-enquiry",source:"host-fixture",summary:"Consulta ficticia para comprobar el ciclo gobernado"}),
        },
        {
          kind: source?'reviewed-mail-draft':"simulated-email-draft",
          payload,
          payloadHash: emailHash(payload),
        },
      ];
      values.forEach((value, index) => local(u[index]!, value));
    });
  }
  function decision(r: EmailReview, d: EmailDecision) {
    const unit = units(r.taskId)[5]!;
    const source = sourceFor?.(r.taskId);
    const attempt = begin(unit, r.bindingHash, source ? "p07-human-review" : "m2-local-simulation");
    finish(
      unit,
      attempt,
      {
        kind: source ? "reviewed-mail-human-review" : "exact-human-review",
        decisionId: d.id,
        bindingHash: d.bindingHash,
        decision: d.decision,
        userId: d.userId,
      },
      d.decision === "approved" ? "satisfied" : "unsatisfied",
    );
  }
  function start(r: EmailReview) {
    journal.transaction(() => {
      begin(units(r.taskId)[6]!, r.bindingHash,r.provider??"m2-local-simulation");
    });
  }
  function settle(
    r: EmailReview,
    effects: Array<{
      id: string;
      status: string;
      effective: string;
      observationIds: string[];
      reconciliations: Array<{
        id: string;
        outcome: string;
        observationIds: string[];
      }>;
    }>,
  ) {
    const unit = units(r.taskId)[6]!,
      a = kernel.snapshot().workUnits[unit.id]?.activeAttemptId;
    if (!a) return;
    const effect = effects.at(-1);
    if (!effect) return; // No evidence of external admission; never invent completion or retry.
    journal.transaction(() => {
      if (effect.effective === "unknown") {
        crm?.effect(r.taskId,r.owner,effect);
        if (
          effect.status === "unknown" &&
          kernel.snapshot().attempts[a]!.status !== "unknown"
        )
          apply(r.taskId, { type: "AttemptUnknown", attemptId: a });
        return;
      }
      const obs = [
        ...effect.observationIds,
        ...effect.reconciliations
          .filter((d) => d.outcome === "confirmed_effect")
          .flatMap((d) => d.observationIds),
      ];
      if (effect.effective === "committed" && !obs.length)
        throw new Error("M2_EMAIL_PROOF_REQUIRED");
      const crmProof=crm?.effect(r.taskId,r.owner,effect);
      finish(
        unit,
        a,
        {
          kind: "governed-email-proof",
          ...(r.provider?{provider:r.provider}:{}),
          effectId: effect.id,
          effective: effect.effective,
          observationIds: obs,
          reconciliationIds: effect.reconciliations.map((d) => d.id),
          bindingHash: r.bindingHash,
        },
        effect.effective === "committed" ? "satisfied" : "unsatisfied",
      );
      if (effect.effective !== "committed") return;
      const u = units(r.taskId);
      local(u[7]!, {
        kind: crmProof?"crm-local-interaction":"simulated-crm-interaction",
        contactId: r.payload.contactId,
        effectId: effect.id,
        payloadHash: r.payloadHash,
      });
      local(u[8]!, {
        kind: crmProof?"crm-local-followup":"simulated-crm-followup",
        contactId: r.payload.contactId,
        action: crmProof?"Revisar respuesta y próximos pasos":"Revisar necesidades de la consulta ficticia",
        effectId: effect.id,
      });
      const t = kernel.snapshot().tasks[r.taskId]!;
      if (t.status !== "verifying") return;
      if (
        !t.successCriteria.every(
          (c) => c.kind === "human-approval" && c.approver === r.owner,
        )
      )
        throw new Error("M2_GLOBAL_CRITERION_NOT_SUPPORTED");
      const d = store.decision(r.id);
      if (d?.decision !== "approved")
        throw new Error("M2_GLOBAL_REVIEW_REQUIRED");
      const ref = evidence(r.taskId, undefined, {
        kind: sourceFor?.(r.taskId)?'reviewed-mail-workflow-verified':r.provider?"test-preparation-real-email-verified":"simulated-workflow-verified",
        ...(sourceFor?.(r.taskId)?{provider:r.provider??'fake-email'}:{}),
        planHash: r.planHash,
        bindingHash: r.bindingHash,
        approvalId: d.id,
        effectId: effect.id,
        observationIds: obs,
      });
      apply(r.taskId, {
        type: "GlobalTaskCompleted",
        results: t.successCriteria.map((c) => ({
          criterionId: c.id,
          status: "satisfied",
          evidenceRefs: [ref],
        })),
      });
      store.audit({
        id: randomUUID(),
        taskId: r.taskId,
        type: sourceFor?.(r.taskId)?'job.completed.reviewed-mail':r.provider?"job.completed.test-preparation-real-email":"job.completed.simulated",
        reference: ref,
        at: Date.now(),
      });
    });
  }
  function failAdmission(r: EmailReview) {
    journal.transaction(() => {
      const unit = units(r.taskId)[6]!,
        a = kernel.snapshot().workUnits[unit.id]!.activeAttemptId;
      if (a)
        finish(
          unit,
          a,
          {
            kind: "certified-no-dispatch",
            bindingHash: r.bindingHash,
            reason:
              "No C11 EffectTransaction exists; dispatch cannot precede its durable marker",
          },
          "unsatisfied",
        );
    });
  }
  return {
    prepare,
    decision,
    start,
    settle,
    failAdmission,
    restore: (effectsFor: (r: EmailReview) => Parameters<typeof settle>[1]) => {
      for (const r of store.listReviews())
        if (
          store.latest(r.taskId)?.id === r.id &&
          kernel.snapshot().tasks[r.taskId]
        ) {
          const effects = effectsFor(r);
          if (effects.length) settle(r, effects);
          else failAdmission(r);
        }
    },
  };
}
