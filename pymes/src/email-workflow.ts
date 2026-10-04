import {parseMailCancelInput,type MailCancelInput} from './mail-cancellation-contract.js';
import type {MailCancellationStore} from './mail-cancellation-store.js';
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
  options:{cancellations?:MailCancellationStore;runtimeReady?:()=>boolean;contactName?:(owner:string,id:string)=>string|null;cancellationHooks?:{beforePersist?:()=>void;afterTransition?:()=>void;afterPersist?:()=>void};reprepare?:(taskId:string,owner:string,payload:EmailPayload,guard:()=>void)=>Promise<string>;replacementFor?:(taskId:string)=>string|null;createRevision?:(taskId:string,owner:string,payload:EmailPayload,guard:()=>void)=>Promise<string>;crm?:import('./crm-service.js').CrmWorkflowAdapter;context?:()=>string;simulated?:boolean;draftFrom?:()=>string;validatePayload?:(payload:unknown)=>EmailPayload;sourceFor?:(taskId:string)=>import('./mail-task-contract.js').MailTaskBinding|null;checkSource?:(taskId:string,owner:string)=>Promise<void>;assertSource?:(taskId:string,owner:string)=>void;assertPayload?:(taskId:string,owner:string,p:EmailPayload)=>void}={},
) {
  const busy = new Set<string>(),
    bridge = createEmailTaskBridge(kernel, journal, store, options.crm,options.sourceFor);
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
      ...(options.sourceFor?.(taskId)?{mailSource:options.sourceFor(taskId)}:{}),
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
    options.assertSource?.(taskId,owner);
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
    options.assertPayload?.(taskId,owner,r.payload);
    return r;
  }
  function saveDraft(taskId:string,owner:string,input:{to:string;subject:string;body:string;contactId:string}){
   if(busy.has(taskId)||!options.draftFrom||!options.validatePayload)throw new Error('EMAIL_DRAFT_NOT_AVAILABLE');plan(taskId,owner);
   const bound=options.sourceFor?.(taskId);
   const payload=options.validatePayload({from:options.draftFrom(),to:[input.to],cc:[],bcc:[],subject:input.subject,body:input.body,contactId:input.contactId,...(bound?.reply?{reply:bound.reply}:{})});
   options.assertPayload?.(taskId,owner,payload);
   store.saveDraft({taskId,owner,payload,at:Date.now()});return view(taskId,owner);
  }
  async function propose(taskId: string, owner: string,mayCommit?:()=>boolean) {
    if (busy.has(taskId)) throw new Error("EMAIL_BUSY");
    busy.add(taskId);
    try {
      await options.checkSource?.(taskId,owner);
      if(mayCommit&&!mayCommit())throw new Error('EMAIL_AUTH_CHANGED');
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
      options.assertPayload?.(taskId,owner,payload);
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
      if(mayCommit&&!mayCommit())throw new Error('EMAIL_AUTH_CHANGED');
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
      await options.checkSource?.(taskId,owner);
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
      // Existing effects remain readable/reconcilable even after inbox purge.
      const prior=store.latest(taskId);if(prior&&prior.owner===owner&&governance.view(prior).length){task(taskId,owner);return view(taskId,owner);}
      await options.checkSource?.(taskId,owner);
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
  function claimsForTask(taskId:string){return governance.stores.effects.list().filter(e=>e.taskId===taskId&&e.action==='email.send');}
  function cancellationState(taskId:string,owner:string){
    const {state,t}=task(taskId,owner),source=options.sourceFor?.(taskId);if(!source)return null;
    const claims=claimsForTask(taskId),attempts=Object.values(state.attempts).filter(a=>a.taskId===taskId),review=store.latest(taskId),draft=store.draft(taskId),contactName=options.contactName?.(owner,source.contactId)??null;
    // Local CRM/review steps dispatch within the host. They are not an external
    // send. Unknown providers and the send WorkUnit are conservatively external.
    const local=new Set(['p05-local-crm','p07-reviewed-mail','p07-human-review','m2-local-simulation']);
    const externalStarted=attempts.some(a=>a.startedAt!==undefined&&(!local.has(a.providerId)||state.workUnits[a.workUnitId]?.requiredCapabilities.some(c=>c.capability==='email.send_reply')));
    const active=attempts.some(a=>!['succeeded','failed','cancelled','unknown'].includes(a.status))||t.workUnitIds.some(id=>state.workUnits[id]?.activeAttemptId);
    const blockedReason=!journal.isHealthy()||options.runtimeReady?.()===false?'EMAIL_CANCEL_NOT_READY':claims.length?'EMAIL_CANCEL_C6_CLAIM':t.status==='unknown'||attempts.some(a=>a.status==='unknown')?'EMAIL_CANCEL_UNKNOWN':active?'EMAIL_CANCEL_ACTIVE_ATTEMPT':externalStarted?'EMAIL_CANCEL_EXTERNAL_DISPATCH':options.replacementFor?.(taskId)?'EMAIL_CANCEL_SUPERSEDED':['completed','cancelled','failed'].includes(t.status)?'EMAIL_CANCEL_TERMINAL':null;
    return {canCancel:blockedReason===null,blockedReason,expectedRevision:source.revision??1,expectedStateHash:emailHash(JSON.parse(JSON.stringify({task:t,source,units:t.workUnitIds.map(id=>state.workUnits[id]),attempts,claims,review,decision:review?store.decision(review.id):null,policy:review?store.policy(review.id):null,draft,contactName,replacement:options.replacementFor?.(taskId)??null}))),contactName};
  }
  function cancel(taskId:string,owner:string,raw:MailCancelInput,mayCommit?:()=>boolean){
    task(taskId,owner);const input=parseMailCancelInput(raw),records=options.cancellations;
    if(!records)throw new Error('EMAIL_CANCEL_NOT_CONFIGURED');
    if(!journal.isHealthy()||options.runtimeReady?.()===false)throw new Error('EMAIL_CANCEL_NOT_READY');
    if(mayCommit&&!mayCommit())throw new Error('EMAIL_AUTH_CHANGED');
    const requestHash=emailHash({tenantId:records.tenant,owner,taskId,...input}),existing=records.request(owner,input.requestId);
    if(existing){if(existing.taskId!==taskId||existing.requestHash!==requestHash)throw new Error('EMAIL_CANCEL_REQUEST_CONFLICT');return view(taskId,owner);}
    if(records.task(taskId,owner))throw new Error('EMAIL_CANCEL_ALREADY_CANCELLED');
    if(busy.has(taskId))throw new Error('EMAIL_BUSY');
    const guard=()=>{
      if(mayCommit&&!mayCommit())throw new Error('EMAIL_AUTH_CHANGED');
      const c=cancellationState(taskId,owner);if(!c)throw new Error('EMAIL_CANCEL_NOT_MAIL');
      if(!c.canCancel)throw new Error(c.blockedReason!);
      if(c.expectedRevision!==input.expectedRevision||c.expectedStateHash!==input.expectedStateHash)throw new Error('EMAIL_CANCEL_STALE');
    };
    guard();busy.add(taskId);
    try{
      options.cancellationHooks?.beforePersist?.();
      journal.transaction(()=>{
        guard();const {t}=task(taskId,owner),at=Math.max(Date.now(),t.updatedAt),id='cancel-'+randomUUID();
        records.record({...input,id,tenantId:records.tenant,owner,actor:owner,taskId,at,planVersion:t.planVersion,previousStatus:t.status,requestHash});
        kernel.apply({id:randomUUID(),taskId,at,type:'DecisionRecorded',referenceId:id},kernel.snapshot().revision);
        kernel.apply({id:randomUUID(),taskId,at,type:'EvidenceRecorded',referenceId:id+':evidence'},kernel.snapshot().revision);
        kernel.apply({id:randomUUID(),taskId,at,type:'GlobalTaskCancelled'},kernel.snapshot().revision);
        options.cancellationHooks?.afterTransition?.();
        store.audit({id,taskId,at,type:'job.cancelled.user',reference:id});
      });
      options.cancellationHooks?.afterPersist?.();
    }finally{busy.delete(taskId);}
    return view(taskId,owner);
  }
  async function reprepare(taskId:string,owner:string,cancellationId:string,mayCommit?:()=>boolean){
    task(taskId,owner);const record=options.cancellations?.task(taskId,owner);
    if(!record||record.id!==cancellationId)throw new Error('EMAIL_REPREPARE_CANCELLATION_REQUIRED');
    if(busy.has(taskId))throw new Error('EMAIL_BUSY');busy.add(taskId);
    try{
      if(mayCommit&&!mayCommit())throw new Error('EMAIL_AUTH_CHANGED');
      const existing=options.replacementFor?.(taskId);if(existing)return {taskId,replacementTaskId:existing};
      const guard=()=>{
        const {state,t}=task(taskId,owner);
        if(mayCommit&&!mayCommit())throw new Error('EMAIL_AUTH_CHANGED');
        if(!journal.isHealthy()||options.runtimeReady?.()===false||t.status!=='cancelled'||claimsForTask(taskId).length||t.workUnitIds.some(id=>state.workUnits[id]?.activeAttemptId)||options.replacementFor?.(taskId))throw new Error('EMAIL_REPREPARE_NOT_AVAILABLE');
      };
      guard();const payload=store.latest(taskId)?.payload??store.draft(taskId)?.payload;
      if(!payload||!options.reprepare)throw new Error('EMAIL_REPREPARE_NOT_AVAILABLE');
      return {taskId,replacementTaskId:await options.reprepare(taskId,owner,payload,guard)};
    }finally{busy.delete(taskId);}
  }
  function revisionReady(taskId:string,owner:string){
    const {state,t}=task(taskId,owner);
    return !!options.sourceFor?.(taskId)&&!!store.latest(taskId)&&!options.replacementFor?.(taskId)&&!['completed','cancelled','failed','unknown'].includes(t.status)&&!claimsForTask(taskId).length&&!t.workUnitIds.some(id=>state.workUnits[id]!.activeAttemptId);
  }
  async function revise(taskId:string,owner:string,bindingHash:string,mayCommit?:()=>boolean){
    if(busy.has(taskId))throw new Error('EMAIL_BUSY');busy.add(taskId);
    try{
      task(taskId,owner);const r=store.latest(taskId);
      if(!r||r.owner!==owner||r.bindingHash!==bindingHash)throw new Error('EMAIL_APPROVAL_STALE');
      const existing=options.replacementFor?.(taskId);if(existing)return {taskId,replacementTaskId:existing};
      if(!options.createRevision||!revisionReady(taskId,owner))throw new Error('EMAIL_REVISION_NOT_AVAILABLE');
      const guard=()=>{
        if(mayCommit&&!mayCommit())throw new Error('EMAIL_AUTH_CHANGED');
        if(!revisionReady(taskId,owner)||current(taskId,owner).id!==r.id)throw new Error('EMAIL_REVISION_NOT_AVAILABLE');
      };
      const replacementTaskId=await options.createRevision(taskId,owner,r.payload,guard);
      return {taskId,replacementTaskId};
    }finally{busy.delete(taskId);}
  }
  function view(taskId: string, owner: string) {
    const { t } = task(taskId, owner),
      r = store.latest(taskId);
    const cancellation=options.cancellations?.task(taskId,owner)??null,cancelState=cancellationState(taskId,owner);
    const controls={cancellation,cancellationState:cancelState&&busy.has(taskId)&&cancelState.canCancel?{...cancelState,canCancel:false,blockedReason:'EMAIL_BUSY'}:cancelState,canReprepare:!busy.has(taskId)&&!!cancellation&&t.status==='cancelled'&&!claimsForTask(taskId).length&&!options.replacementFor?.(taskId)&&!!options.reprepare&&journal.isHealthy()&&options.runtimeReady?.()!==false};
    if (!r)
      return {...controls,
        taskId,
        simulated: options.simulated??true,
        status: t.status==='cancelled'&&options.sourceFor?.(taskId)?"cancelled":"plan_ready",
        globalTaskStatus:t.status,
        review: null,
        decision:null,
        policy:null,
        draft:store.draft(taskId)?.payload??null,
        source:options.sourceFor?.(taskId)??null,
        effects: [],
        audit: store.timeline(taskId),
        canRevise:false,
        replacementTaskId:options.replacementFor?.(taskId)??null,
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
    const state = t.status==='cancelled'&&options.sourceFor?.(taskId)?'cancelled':effects.length
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
          (t.status === "blocked" && d?.decision!=="rejected") ||
          policy?.composition === "deny" ||
          policy?.flow === "deny"
        ? "blocked"
        : d?.decision === "rejected"
          ? options.sourceFor?.(taskId)?"rejected":"blocked"
          : d?.decision === "approved"
            ? "approved"
            : "waiting_approval";
    return {
      ...controls,
      taskId,
      simulated: r.provider!=="gmail-email",
      status: state,
      review: r,
      decision: d,
      policy,
      effects,
      audit: store.timeline(taskId),
      globalTaskStatus: t.status,
      scope: options.sourceFor?.(taskId)?'reviewed-mail-workflow':r.provider==="gmail-email"?"test-preparation-real-email":"simulated-email-workflow",
      source:options.sourceFor?.(taskId)??null,
      canRevise:!stale&&revisionReady(taskId,owner),
      replacementTaskId:options.replacementFor?.(taskId)??null,
    };
  }
  return { propose, decide, execute, reconcile, view,saveDraft,revise,cancel,reprepare };
}
export type EmailWorkflowView = ReturnType<
  ReturnType<typeof createEmailWorkflow>["view"]
>;
