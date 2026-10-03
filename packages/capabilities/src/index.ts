export interface CapabilityDefinition { id: string; description: string }
export const validCapabilityId = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/.test(value) && value.length <= 200;
const names = ["code.generate", "code.modify_repo", "code.review", "code.debug", "test.run", "document.write", "document.review", "reasoning.plan", "reasoning.classify", "document.extract", "browser.navigate", "browser.submit", "computer.interact", "filesystem.read", "filesystem.write", "http.request", "api.create_record", "database.query", "image.inspect", "human.approve"];
export class CapabilityRegistry {
  private definitions = new Map<string, CapabilityDefinition>();
  constructor(definitions: CapabilityDefinition[] = names.map(id => ({ id, description: id.replace(/[._]/g, " ") }))) { definitions.forEach(value => this.register(value)); }
  register(value: CapabilityDefinition): void {
    if (!validCapabilityId(value.id) || typeof value.description !== "string" || !value.description.trim() || value.description.length > 1000 || this.definitions.has(value.id)) throw new Error("INVALID_CAPABILITY_DEFINITION");
    this.definitions.set(value.id, structuredClone(value));
  }
  has(id: string): boolean { return this.definitions.has(id); }
  snapshot(): CapabilityDefinition[] { return [...this.definitions.values()].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(value => structuredClone(value)); }
}
