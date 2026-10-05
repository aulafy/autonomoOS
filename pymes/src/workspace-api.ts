import {handleReviewQueue} from './review-api.js';
import {handleMailAssistance} from './mail-assistance-api.js';
import {handleMailTask} from './mail-task-api.js';
import {handleCrmRequest} from './crm-api.js';
import {handleCapsuleRequest} from './capsule-api.js';
import { readRuntimeWorkspace, type TaskRuntimeState } from "@agent-world/task-runtime";
import { createHmac, timingSafeEqual } from "node:crypto";
import { hashSessionToken } from "./auth.js";
import { createApproval, requirePermission, type ApprovalRecord,
  type WorkspacePrincipal, type WorkspaceRole } from "./workspace-policy.js";
import { ingestOpenClawIntoWorkspace } from "./workspace-ingress.js";
import { transitionCase, type CaseState } from "./case-lifecycle.js";
import { createPendingEffect, MAX_EFFECT_RETRIES, type EffectKind, type PendingEffect } from "./effects.js";
import { InMemoryEffectLeaseStore, type EffectLeaseStore } from "./effect-lease.js";
import type { OpenClawEnterpriseEnvelope, OpenClawEnterprisePolicy } from "./openclaw-gateway.js";
import { pilotConfig } from "./config.js";
import type { Channel } from "./domain.js";
import { handleGmailInboxRequest } from "./gmail-inbox-api.js";
export type { ApprovalRecord, WorkspacePrincipal } from "./workspace-policy.js";

export interface WorkspaceInboxRecord {
  id: string;
  tenantId: string;
  state: CaseState;
  summary: string;
  sourceEventId?: string;
  sourceExternalMessageId?: string;
  sourceChannel?: Channel;
  version?: number;
  updatedAt?: string;
}
export interface CaseAuditRecord {
  id: string; tenantId: string; caseId: string; from: CaseState; to: CaseState;
  operation: string; actorId: string; at: string; version: number; requestId?: string;
}

export interface WorkspaceApiRequest {
  method: "GET" | "POST";
  path: string;
  authorization?: string;
  ingressToken?: string;
  ingressSignature?: string;
  requestId?: string;
  body?: unknown;
}

export interface WorkspaceApiResponse {
  status: 200 | 201 | 202 | 400 | 401 | 403 | 404 | 405 | 409 | 503;
  body: Record<string, unknown>;
}

export interface WorkspaceRepository {
  findSession(token: string): WorkspacePrincipal | null;
  revokeSession(token: string): void;
  listInbox(tenantId: string): WorkspaceInboxRecord[];
  appendInbox(record: WorkspaceInboxRecord): void;
  updateInbox(record: WorkspaceInboxRecord): void;
  appendCaseAudit(record: CaseAuditRecord): void;
  listCaseAudit(tenantId: string, caseId: string): CaseAuditRecord[];
  appendEffect(effect: PendingEffect): void;
  updateEffect(effect: PendingEffect): void;
  listEffects(tenantId: string, caseId?: string): PendingEffect[];
  appendApproval(approval: ApprovalRecord): void;
  listApprovals(tenantId: string): ApprovalRecord[];
  effectLeaseStore?(tenantId: string): EffectLeaseStore;
}

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly sessions = new Map<string, WorkspacePrincipal>();
  private readonly inbox = new Map<string, WorkspaceInboxRecord[]>();
  private readonly approvals: ApprovalRecord[] = [];
  private readonly leases = new Map<string, EffectLeaseStore>();
  effectLeaseStore(tenantId: string): EffectLeaseStore {
    const existing = this.leases.get(tenantId);
    if (existing) return existing;
    const store = new InMemoryEffectLeaseStore();
    this.leases.set(tenantId, store);
    return store;
  }
  addSession(token: string, principal: WorkspacePrincipal): void {
    if (!token || token.length < 16 || token.length > 4096) throw new Error("INVALID_SESSION_TOKEN");
    this.sessions.set(hashSessionToken(token), structuredClone(principal));
  }
  findSession(token: string): WorkspacePrincipal | null {
    const value = this.sessions.get(hashSessionToken(token));
    return value ? structuredClone(value) : null;
  }
  revokeSession(token: string): void { this.sessions.delete(hashSessionToken(token)); }
  listInbox(tenantId: string): WorkspaceInboxRecord[] {
    return structuredClone(this.inbox.get(tenantId) ?? []);
  }
  appendInbox(record: WorkspaceInboxRecord): void {
    const records = this.inbox.get(record.tenantId) ?? [];
    if (record.sourceExternalMessageId && record.sourceChannel && records.some(value =>
      value.sourceExternalMessageId === record.sourceExternalMessageId && value.sourceChannel === record.sourceChannel && value.id !== record.id)) {
      throw new Error("INBOX_EXTERNAL_MESSAGE_ALREADY_EXISTS");
    }
    const index = records.findIndex(value => value.id === record.id);
    if (index >= 0) this.inbox.set(record.tenantId, records.map((value, position) => position === index ? structuredClone(record) : value));
    else this.inbox.set(record.tenantId, [...records, structuredClone(record)]);
  }
  updateInbox(record: WorkspaceInboxRecord): void {
    const records = this.inbox.get(record.tenantId) ?? [];
    const index = records.findIndex(value => value.id === record.id);
    if (index < 0) this.appendInbox(record);
    else this.inbox.set(record.tenantId, records.map((value, position) => position === index ? structuredClone(record) : value));
  }
  private readonly audits: CaseAuditRecord[] = [];
  appendCaseAudit(record: CaseAuditRecord): void { this.audits.push(structuredClone(record)); }
  listCaseAudit(tenantId: string, caseId: string): CaseAuditRecord[] {
    return this.audits.filter(value => value.tenantId === tenantId && value.caseId === caseId).map(value => structuredClone(value));
  }
  private readonly effects: PendingEffect[] = [];
  appendEffect(effect: PendingEffect): void {
    if (this.effects.some(value => value.tenantId === effect.tenantId && value.id === effect.id)) throw new Error("EFFECT_ALREADY_EXISTS");
    this.effects.push(structuredClone(effect));
  }
  updateEffect(effect: PendingEffect): void { const index = this.effects.findIndex(v => v.id === effect.id && v.tenantId === effect.tenantId); if (index >= 0) this.effects[index] = structuredClone(effect); }
  listEffects(tenantId: string, caseId?: string): PendingEffect[] { return this.effects.filter(v => v.tenantId === tenantId && (!caseId || v.caseId === caseId)).map(v => structuredClone(v)); }
  appendApproval(approval: ApprovalRecord): void { this.approvals.push(structuredClone(approval)); }
  listApprovals(tenantId: string): ApprovalRecord[] {
    return this.approvals.filter(value => value.tenantId === tenantId)
      .map(value => structuredClone(value));
  }
}

interface ApprovalBody {
  resourceId: string;
  reason: string;
  draftHash: string;
  approvedAt: string;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function pathParts(path: string): string[] | null {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  return parts.length ? parts : null;
}

function tokenFrom(request: WorkspaceApiRequest): string | null {
  const value = request.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

function tokensEqual(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
function safeRequestId(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value : undefined;
}
function validIngressSignature(body: unknown, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret) return true;
  if (!signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(JSON.stringify(body ?? null)).digest("hex");
  return tokensEqual(signature, expected);
}

/**
 * Small HTTP contract for the first PYMES server. It owns authorization and
 * response shaping; persistence can be replaced without changing callers.
 */
export interface WorkspaceRuntimeSource {
  capsules?:import('./capsule-store.js').CapsuleStore;
  reviews?:import('./review-service.js').ReviewService;
  mailTasks?:import('./mail-task-service.js').MailTaskService;
  mailAssistance?:import('./mail-assistance-service.js').MailAssistanceService;
  crm?:import('./crm-service.js').CrmService;
  gmail?:import('./gmail-local-connector.js').GmailLocalConnector;
  /** P04a read-only Gmail inbox sync; separate from /inbox remote cases. */
  gmailInbox?:import('./inbox-service.js').InboxService;
  email?:ReturnType<typeof import('./email-workflow.js').createEmailWorkflow>;
  /** Host selects a tenant-isolated runtime; never a global shared snapshot. */
  snapshotForTenant(tenantId: string): TaskRuntimeState | null;
  principalIdForSession(principal: WorkspacePrincipal): string;
  planTask?(tenantId:string,owner:string,input:{taskId:string;workflow:string},mayCommit?:()=>boolean):Promise<{created:boolean;planVersion:number}>;
  createTask?(tenantId: string, owner: string, input: { id: string; goal: string }): { created: boolean };
}

export class WorkspaceApi {
  constructor(readonly repository: WorkspaceRepository = new InMemoryWorkspaceRepository(),
    private readonly ingress?: { token: string; policy: OpenClawEnterprisePolicy },
    private readonly runtime?: WorkspaceRuntimeSource) {}

  /** Lightweight storage probe used by the process readiness endpoint. */
  isReady(): boolean {
    try { this.repository.listInbox("__readiness_probe__"); return true; }
    catch { return false; }
  }

  addSession(token: string, principal: WorkspacePrincipal): void {
    if (!token || token.length < 16 || token.length > 4096) throw new Error("INVALID_SESSION_TOKEN");
    if (this.repository instanceof InMemoryWorkspaceRepository) this.repository.addSession(token, principal);
    else throw new Error("SESSION_PROVISIONING_REQUIRES_REPOSITORY_OWNER");
  }

  addInbox(record: WorkspaceInboxRecord): void {
    this.repository.appendInbox(record);
  }

  approvalsForTenant(tenantId: string): ApprovalRecord[] {
    return this.repository.listApprovals(tenantId);
  }

  private auditEffect(tenantId: string, effect: PendingEffect, operation: string, at: string, actorId: string, requestId?: string): void {
    const currentCase = this.repository.listInbox(tenantId).find(value => value.id === effect.caseId);
    const priorAudit = this.repository.listCaseAudit(tenantId, effect.caseId);
    this.repository.appendCaseAudit({ id: `audit-${tenantId}-${effect.caseId}-${operation}-${effect.id}-${priorAudit.length}`, tenantId,
      caseId: effect.caseId, from: currentCase?.state ?? "received", to: currentCase?.state ?? "received",
      operation, actorId, at, requestId, version: priorAudit.length ? priorAudit[priorAudit.length - 1]!.version + 1 : currentCase?.version ?? 0 });
  }

  private async handleGmail(request:WorkspaceApiRequest,parts:string[]):Promise<WorkspaceApiResponse>{
   const token=tokenFrom(request),principal=token?this.repository.findSession(token):null;if(!principal)return {status:401,body:{error:'UNAUTHENTICATED'}};
   const tenant=parts[2];if(tenant!==principal.tenantId||principal.role!=='owner')return {status:403,body:{error:'PERMISSION_DENIED'}};
   const gmail=this.runtime?.gmail;if(!gmail)return {status:404,body:{error:'GMAIL_NOT_CONFIGURED'}};const owner=this.runtime!.principalIdForSession(principal);
   const live=()=>{const p=token?this.repository.findSession(token):null;return !!p&&p.tenantId===tenant&&p.userId===owner&&p.role==='owner';};
   try{let result;if(request.method==='GET'&&parts.length===4)result=await gmail.status(owner);
   else if(request.method==='POST'&&parts.length===5){const body=jsonRecord(request.body);if(!body)return {status:400,body:{error:'INVALID_GMAIL_REQUEST'}};
    if(parts[4]==='configure'&&Object.keys(body).sort().join(',')==='clientId,clientSecret')result=await gmail.configure(owner,body);
    else if(parts[4]==='connect'&&Object.keys(body).join(',')==='verification'&&typeof body.verification==='boolean'){const connect=async()=>{if(!live())throw new Error("UNAUTHENTICATED");return gmail.connect(owner,body.verification as boolean,live);};result=this.runtime?.gmailInbox?await this.runtime.gmailInbox.withSuspended(connect):await connect();this.runtime?.gmailInbox?.onAuthorizationChanged();}
    else if(parts[4]==='disconnect'&&Object.keys(body).length===0){const disconnect=async()=>{if(!live())throw new Error("UNAUTHENTICATED");return gmail.disconnect(owner);};result=this.runtime?.gmailInbox?await this.runtime.gmailInbox.withSuspended(disconnect):await disconnect();}
    else if(parts[4]==='check'&&Object.keys(body).length===0)result=await gmail.check(owner);
    else return {status:400,body:{error:'INVALID_GMAIL_REQUEST'}};
   }else return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};
   if(!live())return {status:401,body:{error:'UNAUTHENTICATED'}};return {status:200,body:{tenantId:tenant,...result}};
   }catch{return {status:409,body:{error:'GMAIL_OPERATION_NOT_CONFIRMED'}};}
  }
  private async handleEmail(request:WorkspaceApiRequest,parts:string[]):Promise<WorkspaceApiResponse>{
    const token=tokenFrom(request),principal=token?this.repository.findSession(token):null;
    if(!principal)return {status:401,body:{error:'UNAUTHENTICATED'}};
    const tenant=parts[2],taskId=parts[4];if(tenant!==principal.tenantId)return {status:403,body:{error:'TENANT_SCOPE_DENIED'}};
    if(request.method!=='GET'&&request.method!=='POST'||request.method==='GET'&&parts.length!==6||request.method==='POST'&&parts.length!==7)return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};
    const permission=request.method==='GET'?'readRuntime':['decision','revise','cancel','reprepare'].includes(parts[6]??'')?'approveOffer':parts[6]==='execute'?'executeEffect':'createRuntimeTask';
    try{requirePermission(principal,permission,{tenantId:tenant,id:taskId});}catch{return {status:403,body:{error:'PERMISSION_DENIED'}};}
    if(['revise','cancel','reprepare'].includes(parts[6]??'')&&principal.role!=='owner')return {status:403,body:{error:'PERMISSION_DENIED'}};
    const email=this.runtime?.email;if(!email)return {status:404,body:{error:'EMAIL_SIMULATION_NOT_CONFIGURED'}};
    const owner=this.runtime!.principalIdForSession(principal);
    const visibleEmail=(v:ReturnType<typeof email.view>)=>principal.role==='owner'?v:{...v,canReprepare:false,cancellationState:v.cancellationState?{...v.cancellationState,canCancel:false,blockedReason:'EMAIL_CANCEL_PERMISSION_DENIED'}:null};
    const live=()=>{const p=token?this.repository.findSession(token):null;return Boolean(p&&p.tenantId===tenant&&p.userId===owner&&p.role===principal.role);};
    try{
      if(this.runtime?.gmail&&parts[6]!=='cancel')await this.runtime.gmail.status(owner);
      if(!live())return {status:401,body:{error:'UNAUTHENTICATED'}};
      if(request.method==='GET'&&parts.length===6)return {status:200,body:{tenantId:tenant,...visibleEmail(email.view(taskId,owner))}};
      const body=jsonRecord(request.body);if(!body)return {status:400,body:{error:'INVALID_EMAIL_REQUEST'}};
      let result;
      if(parts[6]==='draft'&&Object.keys(body).sort().join(',')==='body,contactId,subject,to'&&['to','subject','body','contactId'].every(k=>typeof body[k]==='string'))result=email.saveDraft(taskId,owner,body as {to:string;subject:string;body:string;contactId:string});
      else if(parts[6]==='review'&&Object.keys(body).length===0)result=await email.propose(taskId,owner,live);
      else if(parts[6]==='decision'&&Object.keys(body).sort().join(',')==='bindingHash,decision'&&typeof body.bindingHash==='string'&&(body.decision==='approved'||body.decision==='rejected'))result=await email.decide(taskId,owner,{bindingHash:body.bindingHash,decision:body.decision},live);
      else if(parts[6]==='execute'&&Object.keys(body).length===0)result=await email.execute(taskId,owner,live);
      else if(parts[6]==='reconcile'&&Object.keys(body).length===0)result=await email.reconcile(taskId,owner);
      else if(parts[6]==='cancel')result=email.cancel(taskId,owner,body as unknown as import('./mail-cancellation-contract.js').MailCancelInput,live);
      else if(parts[6]==='reprepare'&&Object.keys(body).join(',')==='cancellationId'&&typeof body.cancellationId==='string')result=await email.reprepare(taskId,owner,body.cancellationId,live);
      else if(parts[6]==='revise'&&Object.keys(body).join(',')==='bindingHash'&&typeof body.bindingHash==='string'&&/^[a-f0-9]{64}$/.test(body.bindingHash))result=await email.revise(taskId,owner,body.bindingHash,live);
      else return {status:400,body:{error:'INVALID_EMAIL_REQUEST'}};
      if(!live())return {status:401,body:{error:'UNAUTHENTICATED'}};
      return {status:200,body:{tenantId:tenant,...('cancellationState' in result?visibleEmail(result):result)}};
    }catch(error){const code=error instanceof Error?error.message:'';if(code==='EMAIL_TASK_NOT_FOUND')return {status:404,body:{error:code}};if(code==='EMAIL_CANCEL_INPUT_INVALID')return {status:400,body:{error:code}};if(/^EMAIL_CANCEL_[A-Z0-9_]+$/.test(code)||['EMAIL_BUSY','EMAIL_AUTH_CHANGED','EMAIL_REPREPARE_CANCELLATION_REQUIRED','EMAIL_REPREPARE_NOT_AVAILABLE'].includes(code))return {status:409,body:{error:code}};return {status:409,body:{error:'EMAIL_OPERATION_NOT_CONFIRMED'}};}
  }

  /** Async planning route; existing synchronous contracts remain unchanged. */
  async handleAsync(request:WorkspaceApiRequest):Promise<WorkspaceApiResponse> {
    const parts=pathParts(request.path);
    if(parts?.[0]==='v1'&&parts[1]==='workspaces'&&parts[3]==='capsules')return handleCapsuleRequest(request,parts,this.repository,this.runtime);
    if(parts?.[0]==='v1'&&parts[1]==='workspaces'&&parts[3]==='review-queue')return handleReviewQueue(request,parts,this.repository,this.runtime);
    if(parts?.[0]==='v1'&&parts[1]==='workspaces'&&parts[3]==='mail-tasks'&&parts.length===4)return handleMailTask(request,parts,this.repository,this.runtime);
    if(parts?.[0]==='v1'&&parts[1]==='workspaces'&&parts[3]==='mail-assistance'&&parts.length>=4&&parts.length<=5)return handleMailAssistance(request,parts,this.repository,this.runtime);
    if(parts?.[0]==='v1'&&parts[1]==='workspaces'&&parts[3]==='crm'&&parts.length>=4&&parts.length<=5)return handleCrmRequest(request,parts,this.repository,this.runtime);
    if(parts?.[0]==='v1'&&parts[1]==='workspaces'&&parts[3]==='gmail'&&(parts.length===4||parts.length===5))return this.handleGmail(request,parts);
    if(parts?.[0]==='v1'&&parts[1]==='workspaces'&&parts[3]==='runtime'&&parts[5]==='email'&&(parts.length===6||parts.length===7))return this.handleEmail(request,parts);
    if(parts?.[0]==='v1'&&parts[1]==='workspaces'&&parts[3]==='gmail-inbox'&&parts.length>=4&&parts.length<=6)return handleGmailInboxRequest(request,parts,this.repository,this.runtime);
    if(request.method!=='POST'||parts?.[0]!=='v1'||parts[1]!=='workspaces'||parts[3]!=='runtime'||parts[5]!=='plan'||parts.length!==6)return this.handle(request);
    const token=tokenFrom(request),principal=token?this.repository.findSession(token):null;
    if(!principal)return {status:401,body:{error:'UNAUTHENTICATED'}};
    const tenant=parts[2],taskId=parts[4];
    if(tenant!==principal.tenantId)return {status:403,body:{error:'TENANT_SCOPE_DENIED'}};
    try{requirePermission(principal,'createRuntimeTask',{tenantId:tenant,id:taskId});}
    catch{return {status:403,body:{error:'PERMISSION_DENIED'}};}
    const body=jsonRecord(request.body);
    if(!body||Object.keys(body).some(k=>k!=='workflow')||body.workflow!=='email-lead-v1')return {status:400,body:{error:'INVALID_WORKFLOW'}};
    if(!this.runtime?.planTask)return {status:404,body:{error:'RUNTIME_PLANNER_NOT_CONFIGURED'}};
    const owner=this.runtime.principalIdForSession(structuredClone(principal));
    if(!this.runtime.snapshotForTenant(tenant)?.tasks[taskId]||this.runtime.snapshotForTenant(tenant)?.tasks[taskId]?.owner!==owner)return {status:404,body:{error:'RUNTIME_TASK_NOT_FOUND'}};
    try {
      const result=await this.runtime.planTask(tenant,owner,{taskId,workflow:body.workflow},()=>{
        const live=token?this.repository.findSession(token):null;
        return Boolean(live&&live.userId===principal.userId&&live.tenantId===tenant&&live.role===principal.role);
      });
      // A session revoked while inference ran must not expose the resulting plan.
      const current=token?this.repository.findSession(token):null;
      if(!current||current.userId!==principal.userId||current.tenantId!==tenant)return {status:401,body:{error:'UNAUTHENTICATED'}};
      return {status:result.created?201:200,body:{tenantId:tenant,taskId,...result}};
    } catch(error) {
      const code=error instanceof Error?error.message:'';
      if(code==='RUNTIME_AUTH_CHANGED')return {status:401,body:{error:'UNAUTHENTICATED'}};
      if(code==='RUNTIME_TASK_NOT_FOUND')return {status:404,body:{error:code}};
      if(['RUNTIME_TASK_CHANGED','RUNTIME_PLANNING_IN_PROGRESS','RUNTIME_TASK_NOT_PLANNABLE','RUNTIME_PLAN_WORKFLOW_CONFLICT'].includes(code))return {status:409,body:{error:code}};
      return {status:400,body:{error:'LOCAL_PLAN_NOT_CONFIRMED'}};
    }
  }

  handle(request: WorkspaceApiRequest): WorkspaceApiResponse {
    const ingressParts = pathParts(request.path);
    if (request.method === "POST" && ingressParts?.[0] === "v1" &&
      ingressParts[1] === "workspaces" && ingressParts[3] === "ingress" &&
      ingressParts[4] === "openclaw" && ingressParts.length === 5) {
      const tenantId = ingressParts[2];
      if (!this.ingress || !tokensEqual(request.ingressToken, this.ingress.token) ||
        !validIngressSignature(request.body, request.ingressSignature, this.ingress.policy.signingSecret) ||
        tenantId !== this.ingress.policy.tenantId) {
        return { status: 401, body: { error: "INGRESS_UNAUTHORIZED" } };
      }
      const result = ingestOpenClawIntoWorkspace({
        envelope: request.body as OpenClawEnterpriseEnvelope,
        policy: this.ingress.policy,
        repository: this.repository
      });
      if (result.accepted) {
        this.repository.appendCaseAudit({ id: `audit-${tenantId}-${result.record.id}-0`, tenantId,
          caseId: result.record.id, from: "received", to: "received", operation: "openclaw_ingress",
          actorId: "openclaw-gateway", requestId: safeRequestId(request.requestId), at: request.body && typeof request.body === "object" && !Array.isArray(request.body) &&
            typeof (request.body as Record<string, unknown>).inbound === "object" && (request.body as Record<string, unknown>).inbound !== null &&
            typeof ((request.body as Record<string, unknown>).inbound as Record<string, unknown>).receivedAt === "string"
            ? ((request.body as Record<string, unknown>).inbound as Record<string, unknown>).receivedAt as string
            : new Date().toISOString(), version: 0 });
        return { status: 201, body: result.record as unknown as Record<string, unknown> };
      }
      return { status: result.reason === "DUPLICATE_EVENT" ? 409 : 400, body: { error: result.reason } };
    }
    const token = tokenFrom(request);
    const principal = token ? this.repository.findSession(token) : null;
    if (!principal) return { status: 401, body: { error: "UNAUTHENTICATED" } };
    const parts = pathParts(request.path);
    if (!parts || parts[0] !== "v1" || parts[1] !== "workspaces") {
      return { status: 404, body: { error: "NOT_FOUND" } };
    }
    const tenantId = parts[2];
    if (!tenantId || tenantId !== principal.tenantId) {
      return { status: 403, body: { error: "TENANT_SCOPE_DENIED" } };
    }
    if (request.method === "POST" && parts[3] === "session" && parts[4] === "revoke" && parts.length === 5) {
      this.repository.revokeSession(token!);
      return { status: 200, body: { tenantId, status: "revoked" } };
    }
    const resource = { tenantId, id: tenantId };
    if (request.method === "POST" && parts[3] === "runtime" && parts.length === 4) {
      try { requirePermission(principal, "createRuntimeTask", resource); }
      catch { return { status: 403, body: { error: "PERMISSION_DENIED" } }; }
      if (!this.runtime?.createTask) return { status: 404, body: { error: "RUNTIME_NOT_CONFIGURED" } };
      const body = request.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "INVALID_RUNTIME_TASK" } };
      const input = body as Record<string, unknown>;
      if (Object.keys(input).some(key => !["id", "goal"].includes(key)) || typeof input.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(input.id) || typeof input.goal !== "string" || !input.goal.trim() || input.goal.length > 2000 || /[\u0000-\u001f\u007f]/.test(input.goal)) return { status: 400, body: { error: "INVALID_RUNTIME_TASK" } };
      const owner = this.runtime.principalIdForSession(structuredClone(principal));
      try {
        const result = this.runtime.createTask(tenantId, owner, { id: input.id, goal: input.goal.trim() });
        return { status: result.created ? 201 : 200, body: { tenantId, taskId: input.id, created: result.created } };
      } catch (error) {
        if (error instanceof Error && error.message === "RUNTIME_TASK_ID_CONFLICT") return { status: 409, body: { error: "RUNTIME_TASK_ID_CONFLICT" } };
        throw error;
      }
    }
    if (request.method === "GET" && parts[3] === "runtime" && (parts.length === 4 || parts.length === 5)) {
      try { requirePermission(principal, "readRuntime", resource); }
      catch { return { status: 403, body: { error: "PERMISSION_DENIED" } }; }
      if (!this.runtime) return { status: 404, body: { error: "RUNTIME_NOT_CONFIGURED" } };
      const snapshot = this.runtime.snapshotForTenant(tenantId);
      if (!snapshot) return { status: 404, body: { error: "RUNTIME_NOT_CONFIGURED" } };
      const view = readRuntimeWorkspace(snapshot, this.runtime.principalIdForSession(structuredClone(principal)), parts.length === 5 ? { taskId: parts[4] } : {});
      return { status: 200, body: { tenantId, ...view } };
    }
    if (request.method === "GET" && parts[3] === "inbox" && parts.length === 4) {
      try { requirePermission(principal, "readInbox", resource); }
      catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      return { status: 200, body: { tenantId, items: this.repository.listInbox(tenantId) } };
    }
    if (request.method === "GET" && parts[3] === "attention" && parts.length === 4) {
      try { requirePermission(principal, "readInbox", resource); }
      catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      const items = this.repository.listInbox(tenantId)
        .filter(item => item.state === "pending_review" || item.state === "uncertain")
        .sort((left, right) => {
          const leftTime = left.updatedAt && Number.isFinite(Date.parse(left.updatedAt)) ? Date.parse(left.updatedAt) : Number.POSITIVE_INFINITY;
          const rightTime = right.updatedAt && Number.isFinite(Date.parse(right.updatedAt)) ? Date.parse(right.updatedAt) : Number.POSITIVE_INFINITY;
          return leftTime - rightTime;
        })
        .slice(0, 100);
      return { status: 200, body: { tenantId, items } };
    }
    if (request.method === "GET" && parts[3] === "connectors" && parts.length === 4) {
      try { requirePermission(principal, "readInbox", resource); }
      catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      return { status: 200, body: { tenantId, connectors: [pilotConfig.crm, pilotConfig.calendar] } };
    }
    if (request.method === "GET" && parts[3] === "approvals" && parts.length === 4) {
      try { requirePermission(principal, "readInbox", resource); }
      catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      return { status: 200, body: { tenantId, approvals: this.repository.listApprovals(tenantId) } };
    }
    if (request.method === "GET" && parts[3] === "metrics" && parts.length === 4) {
      try { requirePermission(principal, "readInbox", resource); }
      catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      const inbox = this.repository.listInbox(tenantId);
      const effects = this.repository.listEffects(tenantId);
      const approvals = this.repository.listApprovals(tenantId);
      const failedEffects = effects.filter(effect => effect.status === "failed").length;
      const pendingReview = inbox.filter(item => item.state === "pending_review").length;
      const uncertainCases = inbox.filter(item => item.state === "uncertain").length;
      const stalePending = inbox.filter(item => item.state === "pending_review" && item.updatedAt &&
        Number.isFinite(Date.parse(item.updatedAt)) && Date.now() - Date.parse(item.updatedAt) > 24 * 60 * 60 * 1000).length;
      const byField = <T extends object>(items: readonly T[], field: "state" | "status"): Record<string, number> =>
        items.reduce<Record<string, number>>((counts, item) => {
          const value = (item as Record<string, unknown>)[field];
          if (typeof value === "string") counts[value] = (counts[value] ?? 0) + 1;
          return counts;
        }, {});
      return { status: 200, body: { tenantId, generatedAt: new Date().toISOString(),
        inbox: { total: inbox.length, byState: byField(inbox, "state") },
        effects: { total: effects.length, byStatus: byField(effects, "status") },
        approvals: { total: approvals.length },
        alerts: [
          ...(failedEffects > 0 ? [{ code: "FAILED_EFFECTS", severity: "critical", count: failedEffects }] : []),
          ...(pendingReview > 20 ? [{ code: "INBOX_BACKLOG", severity: "warning", count: pendingReview }] : []),
          ...(uncertainCases > 0 ? [{ code: "UNCERTAIN_CASES", severity: "warning", count: uncertainCases }] : []),
          ...(stalePending > 0 ? [{ code: "STALE_CASES", severity: "warning", count: stalePending }] : [])
        ] } };
    }
    if (request.method === "POST" && parts[3] === "cases" && parts[5] === "transition" && parts.length === 6) {
      const body = jsonRecord(request.body);
      if (!body || typeof body.to !== "string" || typeof body.at !== "string")
        return { status: 400, body: { error: "INVALID_CASE_TRANSITION_BODY" } };
      const item = this.repository.listInbox(tenantId).find(value => value.id === parts[4]);
      if (!item) return { status: 404, body: { error: "CASE_NOT_FOUND" } };
      try {
        if (body.expectedVersion !== undefined &&
          (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== (item.version ?? 0))) {
          return { status: 409, body: { error: "CASE_VERSION_CONFLICT", currentVersion: item.version ?? 0 } };
        }
        const next = transitionCase({ current: { id: item.id, tenantId, state: item.state,
          version: item.version ?? 0, updatedAt: item.updatedAt ?? new Date(0).toISOString() },
          to: body.to as CaseState, principal, at: body.at });
        this.repository.updateInbox({ ...item, state: next.state, version: next.version, updatedAt: next.updatedAt });
        const priorAudit = this.repository.listCaseAudit(tenantId, item.id);
        this.repository.appendCaseAudit({ id: `audit-${tenantId}-${item.id}-${next.version}`, tenantId,
          caseId: item.id, from: item.state, to: next.state, operation: "transition", actorId: principal.userId,
          at: next.updatedAt, requestId: safeRequestId(request.requestId), version: priorAudit.length ? priorAudit[priorAudit.length - 1]!.version + 1 : next.version });
        return { status: 200, body: next as unknown as Record<string, unknown> };
      } catch (error) {
        const message = error instanceof Error ? error.message : "INVALID_CASE_TRANSITION";
        return { status: message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400, body: { error: message } };
      }
    }
    if (request.method === "GET" && parts[3] === "cases" && parts[5] === "audit" && parts.length === 6) {
      try { requirePermission(principal, "readInbox", { tenantId, id: parts[4] }); }
      catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      return { status: 200, body: { tenantId, caseId: parts[4], audit: this.repository.listCaseAudit(tenantId, parts[4]) } };
    }
    if (request.method === "GET" && parts[3] === "effects" && parts.length === 4) {
      try { requirePermission(principal, "readInbox", resource); } catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      const query = request.path.includes("?") ? new URLSearchParams(request.path.slice(request.path.indexOf("?") + 1)).get("status") : null;
      if (query !== null && query !== "confirmed") return { status: 400, body: { error: "INVALID_EFFECT_STATUS_FILTER" } };
      const effects = this.repository.listEffects(tenantId).filter(effect => query === null || effect.status === query);
      return { status: 200, body: { tenantId, effects } };
    }
    if (request.method === "GET" && parts[3] === "effects" && parts.length === 5) {
      try { requirePermission(principal, "readInbox", resource); } catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      const effect = this.repository.listEffects(tenantId).find(value => value.id === parts[4]);
      return effect ? { status: 200, body: effect as unknown as Record<string, unknown> } : { status: 404, body: { error: "EFFECT_NOT_FOUND" } };
    }
    if (request.method === "GET" && parts[3] === "cases" && parts[5] === "effects" && parts.length === 6) {
      try { requirePermission(principal, "readInbox", { tenantId, id: parts[4] }); } catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      return { status: 200, body: { tenantId, caseId: parts[4], effects: this.repository.listEffects(tenantId, parts[4]) } };
    }
    if (request.method === "POST" && parts[3] === "effects" && parts.length === 4) {
      const body = jsonRecord(request.body);
      if (!body || typeof body.id !== "string" || typeof body.caseId !== "string" || typeof body.kind !== "string" || typeof body.requestedAt !== "string" || typeof body.draftHash !== "string" || jsonRecord(body.payload) === null)
        return { status: 400, body: { error: "INVALID_EFFECT_BODY" } };
      try {
        const effect = createPendingEffect({ id: body.id, tenantId, caseId: body.caseId, kind: body.kind as EffectKind,
          payload: jsonRecord(body.payload)!, principal, requestedAt: body.requestedAt, draftHash: body.draftHash });
        this.repository.appendEffect(effect);
        this.auditEffect(tenantId, effect, "effect_requested", effect.requestedAt, principal.userId, safeRequestId(request.requestId));
        return { status: 201, body: effect as unknown as Record<string, unknown> };
      } catch (error) { const message = error instanceof Error ? error.message : "INVALID_PENDING_EFFECT"; return { status: message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400, body: { error: message } }; }
    }
    if (request.method === "POST" && parts[3] === "effects" && parts[5] === "confirm" && parts.length === 6) {
      const body = jsonRecord(request.body);
      if (!body || body.confirm !== true || typeof body.confirmedAt !== "string") return { status: 400, body: { error: "EXPLICIT_CONFIRMATION_REQUIRED" } };
      const effect = this.repository.listEffects(tenantId).find(value => value.id === parts[4]);
      if (!effect) return { status: 404, body: { error: "EFFECT_NOT_FOUND" } };
      try {
        requirePermission(principal, "executeEffect", { tenantId, id: effect.caseId });
        if (effect.status !== "pending" || Number.isNaN(Date.parse(body.confirmedAt))) throw new Error("EFFECT_NOT_PENDING");
        const confirmed = { ...effect, status: "confirmed" as const, confirmedBy: principal.userId, confirmedAt: body.confirmedAt };
        this.repository.updateEffect(confirmed);
        this.auditEffect(tenantId, confirmed, "effect_confirmed", body.confirmedAt, principal.userId, safeRequestId(request.requestId));
        return { status: 200, body: confirmed as unknown as Record<string, unknown> };
      } catch (error) { const message = error instanceof Error ? error.message : "EFFECT_CONFIRMATION_FAILED"; return { status: message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400, body: { error: message } }; }
    }
    if (request.method === "POST" && parts[3] === "effects" && parts[5] === "lease" && parts.length === 6) {
      const body = jsonRecord(request.body);
      if (!body || typeof body.ownerId !== "string") return { status: 400, body: { error: "INVALID_EFFECT_LEASE" } };
      const effect = this.repository.listEffects(tenantId).find(value => value.id === parts[4]);
      if (!effect) return { status: 404, body: { error: "EFFECT_NOT_FOUND" } };
      try {
        requirePermission(principal, "executeEffect", { tenantId, id: effect.caseId });
        if (effect.status !== "confirmed") throw new Error("EFFECT_NOT_CONFIRMED");
        const store = this.repository.effectLeaseStore?.(tenantId);
        if (!store) throw new Error("EFFECT_LEASE_UNAVAILABLE");
        const lease = store.acquire(effect.id, body.ownerId, Date.now());
        if (!lease) return { status: 409, body: { error: "EFFECT_LEASE_UNAVAILABLE" } };
        return { status: 200, body: lease as unknown as Record<string, unknown> };
      } catch (error) { const message = error instanceof Error ? error.message : "EFFECT_LEASE_FAILED"; return { status: message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400, body: { error: message } }; }
    }
    if (request.method === "POST" && parts[3] === "effects" && parts[5] === "result" && parts.length === 6) {
      const body = jsonRecord(request.body);
      if (!body || (body.result !== "succeeded" && body.result !== "failed") || typeof body.executedAt !== "string" || typeof body.note !== "string") return { status: 400, body: { error: "INVALID_EFFECT_RESULT" } };
      const effect = this.repository.listEffects(tenantId).find(value => value.id === parts[4]);
      if (!effect) return { status: 404, body: { error: "EFFECT_NOT_FOUND" } };
      try {
        requirePermission(principal, "executeEffect", { tenantId, id: effect.caseId });
        if (effect.status !== "confirmed") throw new Error("EFFECT_NOT_CONFIRMED");
        if (Number.isNaN(Date.parse(body.executedAt)) || body.note.trim().length < 3 || body.note.trim().length > 2000) throw new Error("INVALID_EFFECT_RESULT");
        const result = { ...effect, status: body.result as "succeeded" | "failed", executedBy: principal.userId, executedAt: body.executedAt, executionNote: body.note.trim() };
        this.repository.updateEffect(result);
        this.auditEffect(tenantId, result, `effect_${body.result}`, body.executedAt, principal.userId, safeRequestId(request.requestId));
        return { status: 200, body: result as unknown as Record<string, unknown> };
      } catch (error) { const message = error instanceof Error ? error.message : "EFFECT_RESULT_FAILED"; return { status: message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400, body: { error: message } }; }
    }
    if (request.method === "POST" && parts[3] === "effects" && parts[5] === "retry" && parts.length === 6) {
      const body = jsonRecord(request.body);
      if (!body || typeof body.requestedAt !== "string" || typeof body.reason !== "string") return { status: 400, body: { error: "INVALID_EFFECT_RETRY" } };
      const effect = this.repository.listEffects(tenantId).find(value => value.id === parts[4]);
      if (!effect) return { status: 404, body: { error: "EFFECT_NOT_FOUND" } };
      try {
        requirePermission(principal, "executeEffect", { tenantId, id: effect.caseId });
        if (effect.status !== "failed" || effect.retryCount >= MAX_EFFECT_RETRIES || Number.isNaN(Date.parse(body.requestedAt)) || body.reason.trim().length < 3 || body.reason.trim().length > 2000) throw new Error(effect.retryCount >= MAX_EFFECT_RETRIES ? "EFFECT_RETRY_LIMIT_REACHED" : "EFFECT_NOT_RETRYABLE");
        const retry = { ...effect, status: "pending" as const, retryCount: effect.retryCount + 1, requestedBy: principal.userId, requestedAt: body.requestedAt,
          executionNote: `${effect.executionNote ? `${effect.executionNote}\n` : ""}Reintento: ${body.reason.trim()}` };
        this.repository.updateEffect(retry);
        this.auditEffect(tenantId, retry, "effect_retried", body.requestedAt, principal.userId, safeRequestId(request.requestId));
        return { status: 200, body: retry as unknown as Record<string, unknown> };
      } catch (error) { const message = error instanceof Error ? error.message : "INVALID_EFFECT_RETRY"; return { status: message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400, body: { error: message } }; }
    }
    if (request.method === "POST" && parts[3] === "approvals" && parts.length === 4) {
      const body = jsonRecord(request.body);
      if (!body || typeof body.resourceId !== "string" || typeof body.reason !== "string" ||
        typeof body.draftHash !== "string" || typeof body.approvedAt !== "string") {
        return { status: 400, body: { error: "INVALID_APPROVAL_BODY" } };
      }
      const input: ApprovalBody = { resourceId: body.resourceId, reason: body.reason,
        draftHash: body.draftHash, approvedAt: body.approvedAt };
      try {
        const approval = createApproval({ id: `approval-${this.repository.listApprovals(tenantId).length + 1}`,
          principal, resource: { tenantId, id: input.resourceId }, operation: "approveOffer",
          approvedAt: input.approvedAt, reason: input.reason, draftHash: input.draftHash });
        this.repository.appendApproval(approval);
        return { status: 201, body: structuredClone(approval) as unknown as Record<string, unknown> };
      } catch (error) {
        return { status: error instanceof Error && error.message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400,
          body: { error: error instanceof Error ? error.message : "INVALID_APPROVAL" } };
      }
    }
    return { status: 404, body: { error: "NOT_FOUND" } };
  }
}

export const supportedRoles: readonly WorkspaceRole[] = ["owner", "agent", "reviewer", "worker"];
