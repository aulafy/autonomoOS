import type { ResourceId } from "@agent-world/resources";

// Implemented by a separate control-plane authority subsystem, not by C3.
export interface AuthorityGrantView {
  id: string;
  version: number;
  subjectPrincipalId: string;
  resourceIds: ResourceId[];
  actions: string[];
  issuedAt: number;
  expiresAt?: number;
  revokedAt?: number;
}

export interface AuthoritySource {
  getGrant(grantId: string): AuthorityGrantView | null;
}
