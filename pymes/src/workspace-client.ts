import { isConnectorConfig, type ConnectorStatus } from "./config.js";

export interface WorkspaceClientConfig {
  baseUrl: string;
  tenantId: string;
  token: string;
  requestTimeoutMs?: number;
}

export interface RemoteApproval {
  id: string;
  tenantId: string;
  resourceId: string;
  operation: "approveOffer" | "executeEffect";
  approvedBy: string;
  approvedAt: string;
  reason: string;
  draftHash: string;
}

export interface RemoteInboxRecord {
  id: string;
  tenantId: string;
  state: string;
  summary: string;
  version?: number;
  updatedAt?: string;
}
export interface RemoteConnector { id: string; name: string; status: ConnectorStatus; }
export interface RemoteCaseAudit { id: string; caseId: string; from: string; to: string; actorId: string; at: string; version: number; }
export interface RemoteEffect { id: string; caseId: string; kind: string; status: string; requestedBy: string; requestedAt: string; retryCount?: number; payload: Record<string, unknown>; executionNote?: string; executedBy?: string; executedAt?: string; }
export interface WorkspaceHealth { status: "ok" | "not_ready"; service: string; version: string; retryAfter?: string; }
function isRemoteEffect(value: unknown): value is RemoteEffect {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const effect = value as Record<string, unknown>;
  return typeof effect.id === "string" && effect.id.length > 0 &&
    typeof effect.caseId === "string" && effect.caseId.length > 0 &&
    typeof effect.kind === "string" && effect.kind.length > 0 &&
    typeof effect.status === "string" && effect.status.length > 0 &&
    typeof effect.requestedBy === "string" && effect.requestedBy.length > 0 &&
    typeof effect.requestedAt === "string" && effect.requestedAt.length > 0;
}
function isRemoteApproval(value: unknown, tenantId: string): value is RemoteApproval {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const approval = value as Record<string, unknown>;
  return approval.tenantId === tenantId && typeof approval.id === "string" && !!approval.id &&
    typeof approval.resourceId === "string" && !!approval.resourceId &&
    (approval.operation === "approveOffer" || approval.operation === "executeEffect") &&
    typeof approval.approvedBy === "string" && !!approval.approvedBy &&
    typeof approval.approvedAt === "string" && !!approval.approvedAt &&
    typeof approval.reason === "string" && !!approval.reason &&
    typeof approval.draftHash === "string" && !!approval.draftHash;
}
export class WorkspaceConflictError extends Error {
  constructor(readonly currentVersion: number) { super(`CASE_VERSION_CONFLICT_CURRENT_${currentVersion}`); }
}
export class WorkspaceHttpError extends Error {
  constructor(readonly status: number, message: string, readonly requestId: string | null, readonly retryAfter: string | null) { super(message); }
}

function requestId(): string {
  return typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `pymes-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validConfig(config: WorkspaceClientConfig): void {
  let base: URL;
  try { base = new URL(config.baseUrl.trim()); } catch { throw new Error("INVALID_WORKSPACE_CLIENT_CONFIG"); }
  if (config.baseUrl.trim().length > 2048 || (base.protocol !== "http:" && base.protocol !== "https:") || base.username || base.password || base.search || base.hash ||
    !config.tenantId.trim() || config.tenantId.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(config.tenantId.trim()) || config.token.trim().length < 16 || config.token.trim().length > 4096 || (config.requestTimeoutMs !== undefined && (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 100 || config.requestTimeoutMs > 60000))) throw new Error("INVALID_WORKSPACE_CLIENT_CONFIG");
}

export class WorkspaceClient {
  private lastRequestIdValue: string | null = null;
  constructor(private readonly config: WorkspaceClientConfig,
    private readonly fetcher: typeof fetch = fetch) {
    validConfig(config);
    this.config = { baseUrl: new URL(config.baseUrl.trim()).toString().replace(/\/$/, ""), tenantId: config.tenantId.trim(), token: config.token.trim(), requestTimeoutMs: config.requestTimeoutMs ?? 10000 };
  }

  private async request(path: string, init: RequestInit = {}, acceptedStatuses: readonly number[] = []): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs ?? 10000);
    const correlationId = requestId();
    this.lastRequestIdValue = correlationId;
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl}${path}`, {
        ...init, signal: controller.signal, headers: { Accept: "application/json", Authorization: `Bearer ${this.config.token}`, "X-Request-Id": correlationId,
          ...(init.headers ?? {}) }
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("WORKSPACE_REQUEST_TIMEOUT");
      throw error;
    } finally { clearTimeout(timeout); }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_WORKSPACE_RESPONSE");
    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      const record = body as Record<string, unknown>;
      if (response.status === 409 && record.error === "CASE_VERSION_CONFLICT" && typeof record.currentVersion === "number") {
        throw new WorkspaceConflictError(record.currentVersion);
      }
      throw new WorkspaceHttpError(response.status, typeof record.error === "string" ? record.error : "WORKSPACE_REQUEST_FAILED", response.headers.get("x-request-id"), response.headers.get("retry-after"));
    }
    return body as Record<string, unknown>;
  }
  get lastRequestId(): string | null { return this.lastRequestIdValue; }

  async approvals(): Promise<RemoteApproval[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/approvals`);
    if (!Array.isArray(body.approvals) || !body.approvals.every(item => isRemoteApproval(item, this.config.tenantId))) throw new Error("INVALID_WORKSPACE_APPROVALS");
    return body.approvals as RemoteApproval[];
  }
  async health(): Promise<WorkspaceHealth> {
    const body = await this.request("/healthz");
    if (body.status !== "ok" || typeof body.service !== "string" || typeof body.version !== "string") throw new Error("INVALID_WORKSPACE_HEALTH");
    return body as unknown as WorkspaceHealth;
  }
  async ready(): Promise<WorkspaceHealth> {
    let body: Record<string, unknown>;
    try { body = await this.request("/readyz"); }
    catch (error) {
      if (!(error instanceof WorkspaceHttpError) || error.status !== 503) throw error;
      return { status: "not_ready", service: "pymes-workspace", version: "unknown", retryAfter: error.retryAfter ?? undefined };
    }
    if ((body.status !== "ok" && body.status !== "not_ready") || typeof body.service !== "string" || typeof body.version !== "string") throw new Error("INVALID_WORKSPACE_READINESS");
    return body as unknown as WorkspaceHealth;
  }

  async inbox(): Promise<RemoteInboxRecord[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/inbox`);
    if (!Array.isArray(body.items) || body.items.some(item => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return true;
      const record = item as Record<string, unknown>;
      return record.tenantId !== this.config.tenantId || typeof record.id !== "string" || !record.id ||
        typeof record.state !== "string" || typeof record.summary !== "string";
    })) throw new Error("INVALID_WORKSPACE_INBOX");
    return body.items as RemoteInboxRecord[];
  }
  async connectors(): Promise<RemoteConnector[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/connectors`);
    if (body.tenantId !== this.config.tenantId || !Array.isArray(body.connectors) || !body.connectors.every(isConnectorConfig) ||
      new Set(body.connectors.map(connector => connector.id)).size !== body.connectors.length) {
      throw new Error("INVALID_WORKSPACE_CONNECTORS");
    }
    return body.connectors as RemoteConnector[];
  }

  async approve(input: { resourceId: string; reason: string; draftHash: string; approvedAt: string }): Promise<RemoteApproval> {
    if (!input || typeof input.resourceId !== "string" || !input.resourceId.trim() || input.resourceId.length > 200 ||
      typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2_000 ||
      typeof input.draftHash !== "string" || !input.draftHash.trim() || input.draftHash.length > 512 ||
      typeof input.approvedAt !== "string" || !input.approvedAt.trim()) throw new Error("INVALID_WORKSPACE_APPROVAL_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/approvals`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    });
    if (!isRemoteApproval(body, this.config.tenantId)) throw new Error("INVALID_WORKSPACE_APPROVAL");
    return body;
  }
  async audit(caseId: string): Promise<RemoteCaseAudit[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/cases/${encodeURIComponent(caseId)}/audit`);
    if (body.tenantId !== this.config.tenantId || body.caseId !== caseId || !Array.isArray(body.audit)) throw new Error("INVALID_WORKSPACE_AUDIT");
    return body.audit as RemoteCaseAudit[];
  }
  async transition(caseId: string, to: string, at = new Date().toISOString(), expectedVersion?: number): Promise<void> {
    if (!caseId.trim() || !to.trim() || !at.trim() || (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 0))) {
      throw new Error("INVALID_WORKSPACE_TRANSITION_INPUT");
    }
    await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/cases/${encodeURIComponent(caseId)}/transition`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, at, ...(expectedVersion === undefined ? {} : { expectedVersion }) })
    });
  }
  async effects(): Promise<RemoteEffect[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects`);
    if (body.tenantId !== this.config.tenantId || !Array.isArray(body.effects) || !body.effects.every(isRemoteEffect)) throw new Error("INVALID_WORKSPACE_EFFECTS");
    return body.effects as RemoteEffect[];
  }
  async effectsForCase(caseId: string): Promise<RemoteEffect[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/cases/${encodeURIComponent(caseId)}/effects`);
    if (body.tenantId !== this.config.tenantId || body.caseId !== caseId || !Array.isArray(body.effects) || !body.effects.every(isRemoteEffect)) throw new Error("INVALID_WORKSPACE_EFFECTS");
    return body.effects as RemoteEffect[];
  }
  async effect(effectId: string): Promise<RemoteEffect> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}`);
    if (!isRemoteEffect(body)) throw new Error("INVALID_WORKSPACE_EFFECT");
    return body as unknown as RemoteEffect;
  }
  async confirmEffect(effectId: string, confirmedAt = new Date().toISOString()): Promise<RemoteEffect> {
    if (!effectId.trim() || !confirmedAt.trim()) throw new Error("INVALID_WORKSPACE_EFFECT_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true, confirmedAt })
    });
    if (!isRemoteEffect(body)) throw new Error("INVALID_WORKSPACE_EFFECT");
    return body;
  }
  async reportEffectResult(effectId: string, result: "succeeded" | "failed", note: string): Promise<RemoteEffect> {
    if (!effectId.trim() || (result !== "succeeded" && result !== "failed") || !note.trim()) throw new Error("INVALID_WORKSPACE_EFFECT_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}/result`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result, note, executedAt: new Date().toISOString() })
    });
    if (!isRemoteEffect(body)) throw new Error("INVALID_WORKSPACE_EFFECT");
    return body;
  }
  async retryEffect(effectId: string, reason: string, requestedAt = new Date().toISOString()): Promise<RemoteEffect> {
    if (!effectId.trim() || !reason.trim() || !requestedAt.trim()) throw new Error("INVALID_WORKSPACE_EFFECT_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}/retry`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, requestedAt })
    });
    if (!isRemoteEffect(body)) throw new Error("INVALID_WORKSPACE_EFFECT");
    return body;
  }
  async revokeSession(): Promise<void> {
    await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/session/revoke`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
  }
}
