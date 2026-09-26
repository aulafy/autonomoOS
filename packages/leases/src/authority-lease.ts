import type { ResourceId } from "@agent-world/resources";

export type AuthorityLeaseStatus = "active" | "suspended" | "revoked" | "expired";
export interface AuthorityLease {
  id: string;
  grantId: string;
  grantVersion: number;
  subjectPrincipalId: string;
  taskId: string;
  resourceIds: ResourceId[];
  actions: string[];
  issuedAt: number;
  notBefore: number;
  expiresAt: number;
  status: AuthorityLeaseStatus;
  version: number;
}
export interface IssueAuthorityLeaseInput {
  id: string;
  grantId: string;
  subjectPrincipalId: string;
  taskId: string;
  resourceIds: ResourceId[];
  actions: string[];
  notBefore: number;
  expiresAt: number;
}
