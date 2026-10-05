import { defineCapsule, CLIENT_SUMMARY_ID, CapsuleError, type CapsuleManifest } from './capsule-sdk.js';
/** Reviewed, compiled-in modules only. A client cannot register arbitrary code. */
export class CapsuleRegistry {
  private definitions = new Map<string, CapsuleManifest>();
  constructor(manifests: unknown[] = [clientSummaryCapsule]) { manifests.forEach(m => this.register(m)); }
  register(value: unknown): void {
    const manifest = defineCapsule(value);
    if (this.definitions.has(manifest.id)) throw new CapsuleError('CAPSULE_ID_CONFLICT');
    if (this.definitions.size >= 100) throw new CapsuleError('CAPSULE_REGISTRY_LIMIT');
    this.definitions.set(manifest.id, manifest);
  }
  get(id: string): CapsuleManifest {
    const value = this.definitions.get(id); if (!value) throw new CapsuleError('CAPSULE_NOT_FOUND');
    return structuredClone(value);
  }
  list(): CapsuleManifest[] { return [...this.definitions.values()].map(v => structuredClone(v)); }
}
export const clientSummaryCapsule = defineCapsule({ id: CLIENT_SUMMARY_ID, version: '1.0.0', sdkVersion: 1,
  name: 'Resumen de clientes', description: 'Contactos y próximos pasos del CRM local, en una vista de solo lectura.',
  author: 'Aulafy', license: 'MIT', renderer: 'crm.contact-summary',
  capabilities: ['database.query'], resources: ['crm.local.contacts'],
  defaults: { title: 'Mis clientes', limit: 12, relationship: 'all' } });
