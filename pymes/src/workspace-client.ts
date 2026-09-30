import { isConnectorConfig, supportedChannels, type ConnectorStatus } from "./config.js";
const MAX_REMOTE_ITEMS = 10_000;
const MAX_REMOTE_RESPONSE_BYTES = 1_048_576;

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
  sourceEventId?: string;
  sourceExternalMessageId?: string;
  sourceChannel?: string;
  version?: number;
  updatedAt?: string;
}
export interface RemoteConnector { id: string; name: string; status: ConnectorStatus; }
export interface RemoteCaseAudit { id: string; caseId: string; from: string; to: string; operation: string; actorId: string; at: string; version: number; requestId?: string; }
export interface RemoteEffect { tenantId: string; id: string; caseId: string; kind: string; status: string; requestedBy: string; requestedAt: string; retryCount?: number; draftHash?: string; payload: Record<string, unknown>; executionNote?: string; executedBy?: string; executedAt?: string; confirmedBy?: string; confirmedAt?: string; }
export type WorkspaceEffectKind = "call" | "calendar" | "message" | "crm_task";
export interface WorkspaceHealth { status: "ok" | "not_ready"; service: string; version: string; retryAfter?: string; }
export interface WorkspaceMetrics {
  tenantId: string;
  generatedAt: string;
  inbox: { total: number; byState: Record<string, number> };
  effects: { total: number; byStatus: Record<string, number> };
  approvals: { total: number };
  alerts?: Array<{ code: "FAILED_EFFECTS" | "INBOX_BACKLOG" | "STALE_CASES"; severity: "warning" | "critical"; count: number }>;
}
function isRemoteEffect(value: unknown, tenantId: string): value is RemoteEffect {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const effect = value as Record<string, unknown>;
  return effect.tenantId === tenantId && typeof effect.id === "string" && validResourceId(effect.id) &&
    typeof effect.caseId === "string" && validResourceId(effect.caseId) &&
    (effect.kind === "call" || effect.kind === "calendar" || effect.kind === "message" || effect.kind === "crm_task") &&
    (effect.status === "pending" || effect.status === "confirmed" || effect.status === "succeeded" || effect.status === "failed") &&
    typeof effect.requestedBy === "string" && validInputText(effect.requestedBy, 200) &&
    typeof effect.requestedAt === "string" && validTimestamp(effect.requestedAt) &&
    (effect.draftHash === undefined || (typeof effect.draftHash === "string" && validInputText(effect.draftHash, 512))) &&
    effect.payload !== null && typeof effect.payload === "object" && !Array.isArray(effect.payload) &&
    (effect.retryCount === undefined || (Number.isInteger(effect.retryCount) && (effect.retryCount as number) >= 0 && (effect.retryCount as number) <= 1_000)) &&
    (effect.executionNote === undefined || (typeof effect.executionNote === "string" && validMultilineText(effect.executionNote, 2_000))) &&
    (effect.executedBy === undefined || (typeof effect.executedBy === "string" && validInputText(effect.executedBy, 200))) &&
    (effect.executedAt === undefined || (typeof effect.executedAt === "string" && validTimestamp(effect.executedAt))) &&
    (effect.confirmedBy === undefined || (typeof effect.confirmedBy === "string" && validInputText(effect.confirmedBy, 200))) &&
    (effect.confirmedAt === undefined || (typeof effect.confirmedAt === "string" && validTimestamp(effect.confirmedAt)));
}
function isRemoteApproval(value: unknown, tenantId: string): value is RemoteApproval {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const approval = value as Record<string, unknown>;
  return approval.tenantId === tenantId && typeof approval.id === "string" && validResourceId(approval.id) &&
    typeof approval.resourceId === "string" && validResourceId(approval.resourceId) &&
    (approval.operation === "approveOffer" || approval.operation === "executeEffect") &&
    typeof approval.approvedBy === "string" && validInputText(approval.approvedBy, 200) &&
    typeof approval.approvedAt === "string" && validTimestamp(approval.approvedAt) &&
    typeof approval.reason === "string" && validInputText(approval.reason, 2_000) &&
    typeof approval.draftHash === "string" && validInputText(approval.draftHash, 512);
}
function validResourceId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}
function validInputText(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}
function validMultilineText(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function validTimestamp(value: string): boolean {
  return validInputText(value, 100) && Number.isFinite(Date.parse(value));
}
function safeHeaderValue(value: string | null, maxLength = 200): string | null {
  const normalized = value?.trim() ?? "";
  return normalized && normalized.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
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
    !config.tenantId.trim() || config.tenantId.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(config.tenantId.trim()) || config.token.trim().length < 16 || config.token.trim().length > 4096 || /[\u0000-\u001f\u007f]/.test(config.token) || (config.requestTimeoutMs !== undefined && (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 100 || config.requestTimeoutMs > 60000))) throw new Error("INVALID_WORKSPACE_CLIENT_CONFIG");
}

export class WorkspaceClient {
  private lastRequestIdValue: string | null = null;
  private lastStatusValue: number | null = null;
  private lastResponseRequestIdValue: string | null = null;
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
    this.lastStatusValue = null;
    this.lastResponseRequestIdValue = null;
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl}${path}`, {
        ...init, signal: controller.signal, headers: { Accept: "application/json", "Cache-Control": "no-store", Authorization: `Bearer ${this.config.token}`, "X-Request-Id": correlationId,
          ...(init.headers ?? {}) }
      });
    } catch (error) {
      clearTimeout(timeout);
      if (controller.signal.aborted) throw new Error("WORKSPACE_REQUEST_TIMEOUT");
      throw error;
    }
    this.lastStatusValue = response.status;
    this.lastResponseRequestIdValue = safeHeaderValue(response.headers.get("x-request-id"));
    const contentLength = response.headers.get("content-length");
    if (contentLength && (/^\d+$/.test(contentLength) === false || Number(contentLength) > MAX_REMOTE_RESPONSE_BYTES)) {
      clearTimeout(timeout);
      throw new Error("WORKSPACE_RESPONSE_TOO_LARGE");
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType && contentType !== "application/json") {
      clearTimeout(timeout);
      throw new Error("INVALID_WORKSPACE_CONTENT_TYPE");
    }
    let body: unknown;
    try {
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_REMOTE_RESPONSE_BYTES) {
        clearTimeout(timeout);
        throw new Error("WORKSPACE_RESPONSE_TOO_LARGE");
      }
      body = raw ? JSON.parse(raw) : undefined;
    }
    catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.message === "WORKSPACE_RESPONSE_TOO_LARGE") throw error;
      if (controller.signal.aborted) throw new Error("WORKSPACE_REQUEST_TIMEOUT");
      throw new Error("INVALID_WORKSPACE_RESPONSE");
    }
    clearTimeout(timeout);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_WORKSPACE_RESPONSE");
    if (!response.ok && !acceptedStatuses.includes(response.status)) {
      const record = body as Record<string, unknown>;
      if (response.status === 409 && record.error === "CASE_VERSION_CONFLICT" && typeof record.currentVersion === "number") {
        throw new WorkspaceConflictError(record.currentVersion);
      }
      const message = typeof record.error === "string" && validInputText(record.error, 200) ? record.error.trim() : "WORKSPACE_REQUEST_FAILED";
      throw new WorkspaceHttpError(response.status, message, this.lastResponseRequestIdValue, safeHeaderValue(response.headers.get("retry-after")));
    }
    return body as Record<string, unknown>;
  }
  get lastRequestId(): string | null { return this.lastRequestIdValue; }
  get lastStatus(): number | null { return this.lastStatusValue; }
  get lastResponseRequestId(): string | null { return this.lastResponseRequestIdValue; }

  async approvals(): Promise<RemoteApproval[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/approvals`);
    if (body.tenantId !== this.config.tenantId || !Array.isArray(body.approvals) || body.approvals.length > MAX_REMOTE_ITEMS || !body.approvals.every(item => isRemoteApproval(item, this.config.tenantId)) ||
      new Set(body.approvals.map(item => item.id)).size !== body.approvals.length) throw new Error("INVALID_WORKSPACE_APPROVALS");
    return body.approvals as RemoteApproval[];
  }
  async health(): Promise<WorkspaceHealth> {
    const body = await this.request("/healthz");
    if (body.status !== "ok" || typeof body.service !== "string" || !validInputText(body.service, 200) || typeof body.version !== "string" || !validInputText(body.version, 200)) throw new Error("INVALID_WORKSPACE_HEALTH");
    return body as unknown as WorkspaceHealth;
  }
  async ready(): Promise<WorkspaceHealth> {
    let body: Record<string, unknown>;
    try { body = await this.request("/readyz"); }
    catch (error) {
      if (!(error instanceof WorkspaceHttpError) || error.status !== 503) throw error;
      return { status: "not_ready", service: "pymes-workspace", version: "unknown", retryAfter: error.retryAfter ?? undefined };
    }
    if ((body.status !== "ok" && body.status !== "not_ready") || typeof body.service !== "string" || !validInputText(body.service, 200) || typeof body.version !== "string" || !validInputText(body.version, 200) ||
      (body.retryAfter !== undefined && (typeof body.retryAfter !== "string" || !validInputText(body.retryAfter, 200)))) throw new Error("INVALID_WORKSPACE_READINESS");
    return body as unknown as WorkspaceHealth;
  }

  async inbox(): Promise<RemoteInboxRecord[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/inbox`);
    if (body.tenantId !== this.config.tenantId || !Array.isArray(body.items) || body.items.length > MAX_REMOTE_ITEMS || body.items.some(item => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return true;
      const record = item as Record<string, unknown>;
      return record.tenantId !== this.config.tenantId || typeof record.id !== "string" || !record.id ||
        typeof record.state !== "string" || !validInputText(record.state, 100) ||
        typeof record.summary !== "string" || !validInputText(record.summary, 4_000) ||
        (record.sourceEventId !== undefined && (typeof record.sourceEventId !== "string" || !validResourceId(record.sourceEventId))) ||
        (record.sourceExternalMessageId !== undefined && (typeof record.sourceExternalMessageId !== "string" || !validResourceId(record.sourceExternalMessageId))) ||
        (record.sourceChannel !== undefined && (typeof record.sourceChannel !== "string" || !supportedChannels.includes(record.sourceChannel as typeof supportedChannels[number]))) ||
        (record.version !== undefined && (!Number.isInteger(record.version) || (record.version as number) < 0)) ||
        (record.updatedAt !== undefined && (typeof record.updatedAt !== "string" || !validTimestamp(record.updatedAt)));
    }) || new Set(body.items.map(item => (item as Record<string, unknown>).id)).size !== body.items.length) throw new Error("INVALID_WORKSPACE_INBOX");
    return body.items as RemoteInboxRecord[];
  }
  async connectors(): Promise<RemoteConnector[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/connectors`);
    if (body.tenantId !== this.config.tenantId || !Array.isArray(body.connectors) || body.connectors.length > 100 || !body.connectors.every(isConnectorConfig) ||
      new Set(body.connectors.map(connector => connector.id)).size !== body.connectors.length) {
      throw new Error("INVALID_WORKSPACE_CONNECTORS");
    }
    return body.connectors as RemoteConnector[];
  }
  async metrics(): Promise<WorkspaceMetrics> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/metrics`);
    const validCounts = (value: unknown): value is Record<string, number> => value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.entries(value).length <= 100 && Object.entries(value).every(([key, count]) => validInputText(key, 100) && Number.isInteger(count) && count >= 0 && count <= MAX_REMOTE_ITEMS);
    const validBucket = (value: unknown, field: "byState" | "byStatus"): value is { total: number } & Record<typeof field, Record<string, number>> =>
      value !== null && typeof value === "object" && !Array.isArray(value) && Number.isInteger((value as Record<string, unknown>).total) &&
      ((value as Record<string, unknown>).total as number) >= 0 && ((value as Record<string, unknown>).total as number) <= MAX_REMOTE_ITEMS && validCounts((value as Record<string, unknown>)[field]);
    const coherentBucket = (value: unknown, field: "byState" | "byStatus"): boolean => {
      if (!validBucket(value, field)) return false;
      const bucket = value as { total: number } & Record<typeof field, Record<string, number>>;
      return Object.values(bucket[field]).reduce((sum, count) => sum + count, 0) === bucket.total;
    };
    const validAlerts = body.alerts === undefined || (Array.isArray(body.alerts) && body.alerts.length <= 20 && body.alerts.every(alert =>
      alert !== null && typeof alert === "object" && !Array.isArray(alert) &&
      ((alert as Record<string, unknown>).code === "FAILED_EFFECTS" || (alert as Record<string, unknown>).code === "INBOX_BACKLOG" || (alert as Record<string, unknown>).code === "STALE_CASES") &&
      ((alert as Record<string, unknown>).severity === "warning" || (alert as Record<string, unknown>).severity === "critical") &&
      Number.isInteger((alert as Record<string, unknown>).count) && ((alert as Record<string, unknown>).count as number) > 0 && ((alert as Record<string, unknown>).count as number) <= MAX_REMOTE_ITEMS));
    if (body.tenantId !== this.config.tenantId || typeof body.generatedAt !== "string" || !validTimestamp(body.generatedAt) ||
      !coherentBucket(body.inbox, "byState") || !coherentBucket(body.effects, "byStatus") || body.approvals === null || typeof body.approvals !== "object" ||
      Array.isArray(body.approvals) || !Number.isInteger((body.approvals as Record<string, unknown>).total) ||
      ((body.approvals as Record<string, unknown>).total as number) < 0 || ((body.approvals as Record<string, unknown>).total as number) > MAX_REMOTE_ITEMS || !validAlerts) {
      throw new Error("INVALID_WORKSPACE_METRICS");
    }
    return body as unknown as WorkspaceMetrics;
  }

  async approve(input: { resourceId: string; reason: string; draftHash: string; approvedAt: string }): Promise<RemoteApproval> {
    if (!input || typeof input.resourceId !== "string" || !validResourceId(input.resourceId) ||
      typeof input.reason !== "string" || !validInputText(input.reason, 2_000) ||
      typeof input.draftHash !== "string" || !validInputText(input.draftHash, 512) ||
      typeof input.approvedAt !== "string" || !validTimestamp(input.approvedAt)) throw new Error("INVALID_WORKSPACE_APPROVAL_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/approvals`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    });
    if (!isRemoteApproval(body, this.config.tenantId)) throw new Error("INVALID_WORKSPACE_APPROVAL");
    return body;
  }
  async audit(caseId: string): Promise<RemoteCaseAudit[]> {
    if (!validResourceId(caseId)) throw new Error("INVALID_WORKSPACE_CASE_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/cases/${encodeURIComponent(caseId)}/audit`);
    if (body.tenantId !== this.config.tenantId || body.caseId !== caseId || !Array.isArray(body.audit) || body.audit.some(item => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return true;
      const audit = item as Record<string, unknown>;
      return typeof audit.id !== "string" || !validResourceId(audit.id) || audit.caseId !== caseId ||
        typeof audit.from !== "string" || !validInputText(audit.from, 100) || typeof audit.to !== "string" || !validInputText(audit.to, 100) ||
        typeof audit.operation !== "string" || !validInputText(audit.operation, 100) ||
        typeof audit.actorId !== "string" || !validInputText(audit.actorId, 200) || typeof audit.at !== "string" || !validTimestamp(audit.at) ||
        !Number.isInteger(audit.version) || (audit.version as number) < 0 ||
        (audit.requestId !== undefined && (typeof audit.requestId !== "string" || !validResourceId(audit.requestId)));
    })) throw new Error("INVALID_WORKSPACE_AUDIT");
    const auditEntries = body.audit as unknown[];
    if (new Set(auditEntries.map(item => (item as Record<string, unknown>).id)).size !== auditEntries.length ||
      auditEntries.some((item, index) => index > 0 && (item as Record<string, unknown>).version as number <= ((auditEntries[index - 1] as Record<string, unknown>).version as number))) {
      throw new Error("INVALID_WORKSPACE_AUDIT");
    }
    return auditEntries as RemoteCaseAudit[];
  }
  async transition(caseId: string, to: string, at = new Date().toISOString(), expectedVersion?: number): Promise<void> {
    if (!validResourceId(caseId) || !validInputText(to, 100) || !validTimestamp(at) || (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 0))) {
      throw new Error("INVALID_WORKSPACE_TRANSITION_INPUT");
    }
    await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/cases/${encodeURIComponent(caseId)}/transition`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, at, ...(expectedVersion === undefined ? {} : { expectedVersion }) })
    });
  }
  async effects(): Promise<RemoteEffect[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects`);
    if (body.tenantId !== this.config.tenantId || !Array.isArray(body.effects) || body.effects.length > MAX_REMOTE_ITEMS || !body.effects.every(item => isRemoteEffect(item, this.config.tenantId)) ||
      new Set(body.effects.map(item => item.id)).size !== body.effects.length) throw new Error("INVALID_WORKSPACE_EFFECTS");
    return body.effects as RemoteEffect[];
  }
  async effectsForCase(caseId: string): Promise<RemoteEffect[]> {
    if (!validResourceId(caseId)) throw new Error("INVALID_WORKSPACE_CASE_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/cases/${encodeURIComponent(caseId)}/effects`);
    if (body.tenantId !== this.config.tenantId || body.caseId !== caseId || !Array.isArray(body.effects) || body.effects.length > MAX_REMOTE_ITEMS || !body.effects.every(item => isRemoteEffect(item, this.config.tenantId)) ||
      new Set(body.effects.map(item => item.id)).size !== body.effects.length) throw new Error("INVALID_WORKSPACE_EFFECTS");
    return body.effects as RemoteEffect[];
  }
  async createEffect(input: { id: string; caseId: string; kind: WorkspaceEffectKind; payload: Record<string, unknown>; requestedAt?: string; draftHash: string }): Promise<RemoteEffect> {
    let payloadBytes = -1;
    try { payloadBytes = input?.payload ? new TextEncoder().encode(JSON.stringify(input.payload)).byteLength : -1; }
    catch { payloadBytes = -1; }
    if (!input || !validResourceId(input.id) || !validResourceId(input.caseId) ||
      !["call", "calendar", "message", "crm_task"].includes(input.kind) ||
      !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload) || Object.keys(input.payload).length === 0 ||
      payloadBytes < 0 || payloadBytes > 65536 ||
      !validInputText(input.draftHash, 512) ||
      (input.requestedAt !== undefined && !validTimestamp(input.requestedAt))) {
      throw new Error("INVALID_WORKSPACE_EFFECT_INPUT");
    }
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, requestedAt: input.requestedAt ?? new Date().toISOString() })
    });
    if (!isRemoteEffect(body, this.config.tenantId)) throw new Error("INVALID_WORKSPACE_EFFECT");
    return body;
  }
  async effect(effectId: string): Promise<RemoteEffect> {
    if (!validResourceId(effectId)) throw new Error("INVALID_WORKSPACE_EFFECT_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}`);
    if (!isRemoteEffect(body, this.config.tenantId)) throw new Error("INVALID_WORKSPACE_EFFECT");
    return body;
  }
  async confirmEffect(effectId: string, confirmedAt = new Date().toISOString()): Promise<RemoteEffect> {
    if (!validResourceId(effectId) || !validTimestamp(confirmedAt)) throw new Error("INVALID_WORKSPACE_EFFECT_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true, confirmedAt })
    });
    if (!isRemoteEffect(body, this.config.tenantId)) throw new Error("INVALID_WORKSPACE_EFFECT");
    return body;
  }
  async reportEffectResult(effectId: string, result: "succeeded" | "failed", note: string): Promise<RemoteEffect> {
    if (!validResourceId(effectId) || (result !== "succeeded" && result !== "failed") || !validInputText(note, 2_000)) throw new Error("INVALID_WORKSPACE_EFFECT_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}/result`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result, note, executedAt: new Date().toISOString() })
    });
    if (!isRemoteEffect(body, this.config.tenantId)) throw new Error("INVALID_WORKSPACE_EFFECT");
    return body;
  }
  async retryEffect(effectId: string, reason: string, requestedAt = new Date().toISOString()): Promise<RemoteEffect> {
    if (!validResourceId(effectId) || !validInputText(reason, 2_000) || !validTimestamp(requestedAt)) throw new Error("INVALID_WORKSPACE_EFFECT_INPUT");
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}/retry`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, requestedAt })
    });
    if (!isRemoteEffect(body, this.config.tenantId)) throw new Error("INVALID_WORKSPACE_EFFECT");
    return body;
  }
  async revokeSession(): Promise<void> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/session/revoke`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    if (body.tenantId !== this.config.tenantId || body.status !== "revoked") throw new Error("INVALID_WORKSPACE_REVOKE_RESPONSE");
  }
}
