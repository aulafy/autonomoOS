export interface AgentIdentity {
  id: string;
  ownerId: string;
  displayName: string;
  provider: string;
  capabilities: string[];
}
