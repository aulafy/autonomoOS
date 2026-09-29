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

function validConfig(config: WorkspaceClientConfig): void {
  if (!config.baseUrl || !/^https?:\/\//.test(config.baseUrl) ||
    !config.tenantId || !config.token) throw new Error("INVALID_WORKSPACE_CLIENT_CONFIG");
}

export class WorkspaceClient {
  constructor(private readonly config: WorkspaceClientConfig,
    private readonly fetcher: typeof fetch = fetch) { validConfig(config); }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init, headers: { Accept: "application/json", Authorization: `Bearer ${this.config.token}`,
        ...(init.headers ?? {}) }
    });
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_WORKSPACE_RESPONSE");
    if (!response.ok) throw new Error(typeof (body as Record<string, unknown>).error === "string"
      ? (body as Record<string, string>).error : "WORKSPACE_REQUEST_FAILED");
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
  async transition(caseId: string, to: string, at = new Date().toISOString()): Promise<void> {
    await this.request(`/v1/workspaces/${encodeURIComponent(this.config.tenantId)}/cases/${encodeURIComponent(caseId)}/transition`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, at })
    });
  }
}
