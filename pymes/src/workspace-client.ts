export interface WorkspaceClientConfig {
  baseUrl: string;
  tenantId: string;
  token: string;
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
export interface RemoteCaseAudit { id: string; caseId: string; from: string; to: string; actorId: string; at: string; version: number; }
export interface RemoteEffect { id: string; caseId: string; kind: string; status: string; requestedBy: string; requestedAt: string; retryCount?: number; payload: Record<string, unknown>; executionNote?: string; executedBy?: string; executedAt?: string; }
export class WorkspaceConflictError extends Error {
  constructor(readonly currentVersion: number) { super(`CASE_VERSION_CONFLICT_CURRENT_${currentVersion}`); }
}

function validConfig(config: WorkspaceClientConfig): void {
  if (!config.baseUrl || !/^https?:\/\//.test(config.baseUrl.trim()) ||
    !config.tenantId.trim() || config.token.trim().length < 16 || config.token.trim().length > 4096) throw new Error("INVALID_WORKSPACE_CLIENT_CONFIG");
}

export class WorkspaceClient {
  constructor(private readonly config: WorkspaceClientConfig,
    private readonly fetcher: typeof fetch = fetch) {
    validConfig(config);
    this.config = { baseUrl: config.baseUrl.trim().replace(/\/$/, ""), tenantId: config.tenantId.trim(), token: config.token.trim() };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init, headers: { Accept: "application/json", Authorization: `Bearer ${this.config.token}`,
        ...(init.headers ?? {}) }
    });
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_WORKSPACE_RESPONSE");
    if (!response.ok) {
      const record = body as Record<string, unknown>;
      if (response.status === 409 && record.error === "CASE_VERSION_CONFLICT" && typeof record.currentVersion === "number") {
        throw new WorkspaceConflictError(record.currentVersion);
      }
      throw new Error(typeof record.error === "string" ? record.error : "WORKSPACE_REQUEST_FAILED");
    }
    return body as Record<string, unknown>;
  }

  async approvals(): Promise<RemoteApproval[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/approvals`);
    if (!Array.isArray(body.approvals)) throw new Error("INVALID_WORKSPACE_APPROVALS");
    return body.approvals as RemoteApproval[];
  }

  async inbox(): Promise<RemoteInboxRecord[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/inbox`);
    if (!Array.isArray(body.items)) throw new Error("INVALID_WORKSPACE_INBOX");
    return body.items as RemoteInboxRecord[];
  }

  async approve(input: { resourceId: string; reason: string; draftHash: string; approvedAt: string }): Promise<RemoteApproval> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/approvals`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
    });
    return body as unknown as RemoteApproval;
  }
  async audit(caseId: string): Promise<RemoteCaseAudit[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/cases/${encodeURIComponent(caseId)}/audit`);
    if (!Array.isArray(body.audit)) throw new Error("INVALID_WORKSPACE_AUDIT");
    return body.audit as RemoteCaseAudit[];
  }
  async transition(caseId: string, to: string, at = new Date().toISOString(), expectedVersion?: number): Promise<void> {
    await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/cases/${encodeURIComponent(caseId)}/transition`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, at, ...(expectedVersion === undefined ? {} : { expectedVersion }) })
    });
  }
  async effects(): Promise<RemoteEffect[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects`);
    if (!Array.isArray(body.effects)) throw new Error("INVALID_WORKSPACE_EFFECTS");
    return body.effects as RemoteEffect[];
  }
  async effectsForCase(caseId: string): Promise<RemoteEffect[]> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/cases/${encodeURIComponent(caseId)}/effects`);
    if (!Array.isArray(body.effects)) throw new Error("INVALID_WORKSPACE_EFFECTS");
    return body.effects as RemoteEffect[];
  }
  async effect(effectId: string): Promise<RemoteEffect> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}`);
    if (typeof body.id !== "string" || typeof body.status !== "string") throw new Error("INVALID_WORKSPACE_EFFECT");
    return body as unknown as RemoteEffect;
  }
  async confirmEffect(effectId: string, confirmedAt = new Date().toISOString()): Promise<RemoteEffect> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true, confirmedAt })
    });
    return body as unknown as RemoteEffect;
  }
  async reportEffectResult(effectId: string, result: "succeeded" | "failed", note: string): Promise<RemoteEffect> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}/result`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result, note, executedAt: new Date().toISOString() })
    });
    return body as unknown as RemoteEffect;
  }
  async retryEffect(effectId: string, reason: string, requestedAt = new Date().toISOString()): Promise<RemoteEffect> {
    const body = await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/effects/${encodeURIComponent(effectId)}/retry`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, requestedAt })
    });
    return body as unknown as RemoteEffect;
  }
  async revokeSession(): Promise<void> {
    await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/session/revoke`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
  }
}
