export interface Capability {
  id: string;
  description: string;
  version: string;
  inputSchema?: Record<string, unknown>;
}
