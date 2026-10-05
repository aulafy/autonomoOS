/** Declarative v1 SDK. No eval, scripts, tokens, SQL or network supplied by a capsule. */
import type { CrmView } from './crm-contract.js';

export const CAPSULE_SDK_VERSION = 1 as const;
export const CLIENT_SUMMARY_ID = 'crm.client-summary';
export type ClientSummaryConfig = { title: string; limit: number; relationship: 'all' | 'client' | 'prospect' };
export interface CapsuleManifest {
  id: string; version: string; sdkVersion: 1; name: string; description: string;
  author: string; license: 'MIT'; renderer: 'crm.contact-summary';
  capabilities: ['database.query']; resources: ['crm.local.contacts'];
  defaults: ClientSummaryConfig;
}
export interface CapsuleInstallation {
  id: string; version: string; enabled: boolean; grants: ['database.query'];
  config: ClientSummaryConfig; updatedAt: number;
}
export interface CapsuleAudit {
  commandId: string; capsuleId: string; revision: number; actor: string;
  at: number; enabled: boolean; version: string;
}
export interface CapsuleCatalog {
  tenantId: string; ownerId: string; revision: number;
  items: Array<{ manifest: CapsuleManifest; installation: CapsuleInstallation | null }>;
  audit: CapsuleAudit[];
}
export interface CapsuleCommand {
  commandId: string; expectedRevision: number; capsuleId: string; version: string;
  enabled: boolean; grants: ['database.query']; config: ClientSummaryConfig;
}
export interface ClientSummary {
  capsuleId: string; version: string; installationRevision: number; crmRevision: number;
  title: string; counts: { contacts: number; leads: number; pending: number; overdue: number };
  contacts: Array<{ id: string; name: string; phone: string; relationship: 'client' | 'prospect' }>;
  truncated: boolean;
}
export class CapsuleError extends Error {}
function invalid(): never { throw new CapsuleError('CAPSULE_INVALID_INPUT'); }
export function capsuleRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).sort().join(',') !== [...allowed].sort().join(',')) invalid();
}
export function capsuleText(value: unknown, max = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid();
  return value;
}
export function capsuleId(value: unknown): string {
  const id = capsuleText(value, 100);
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(id)) invalid();
  return id;
}
export function capsuleRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
  return value as number;
}
export function capsuleConfig(value: unknown): ClientSummaryConfig {
  const r = capsuleRecord(value); keys(r, ['title', 'limit', 'relationship']);
  const title = capsuleText(r.title, 80), limit = capsuleRevision(r.limit);
  if (limit < 1 || limit > 50 || typeof r.relationship !== 'string' || !['all', 'client', 'prospect'].includes(r.relationship)) invalid();
  return { title, limit, relationship: r.relationship as ClientSummaryConfig['relationship'] };
}
function grants(value: unknown): ['database.query'] {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'database.query') invalid();
  return ['database.query'];
}
function version(value: unknown): string {
  const v = capsuleText(value, 40); if (!/^\d+\.\d+\.\d+$/.test(v)) invalid(); return v;
}
export function defineCapsule(value: unknown): CapsuleManifest {
  const r = capsuleRecord(value);
  keys(r, ['id', 'version', 'sdkVersion', 'name', 'description', 'author', 'license', 'renderer', 'capabilities', 'resources', 'defaults']);
  if (r.sdkVersion !== CAPSULE_SDK_VERSION) throw new CapsuleError('CAPSULE_SDK_INCOMPATIBLE');
  if (r.renderer !== 'crm.contact-summary' || r.license !== 'MIT' || !Array.isArray(r.resources) ||
      r.resources.length !== 1 || r.resources[0] !== 'crm.local.contacts') invalid();
  return { id: capsuleId(r.id), version: version(r.version), sdkVersion: 1,
    name: capsuleText(r.name, 80), description: capsuleText(r.description, 500), author: capsuleText(r.author),
    license: 'MIT', renderer: 'crm.contact-summary', capabilities: grants(r.capabilities),
    resources: ['crm.local.contacts'], defaults: capsuleConfig(r.defaults) };
}
export function parseCapsuleCommand(value: unknown): CapsuleCommand {
  const r = capsuleRecord(value); keys(r, ['commandId', 'expectedRevision', 'capsuleId', 'version', 'enabled', 'grants', 'config']);
  const commandId = capsuleText(r.commandId);
  if (!/^[a-zA-Z0-9_-]+$/.test(commandId) || typeof r.enabled !== 'boolean') invalid();
  return { commandId, expectedRevision: capsuleRevision(r.expectedRevision), capsuleId: capsuleId(r.capsuleId),
    version: version(r.version), enabled: r.enabled, grants: grants(r.grants), config: capsuleConfig(r.config) };
}
export function parseCapsuleCatalog(value: unknown, tenant: string): CapsuleCatalog {
  const r = capsuleRecord(value);
  if (r.tenantId !== tenant || !Array.isArray(r.items) || r.items.length > 100 || !Array.isArray(r.audit) || r.audit.length > 30) invalid();
  const ownerId = capsuleText(r.ownerId, 200), revision = capsuleRevision(r.revision);
  const items = r.items.map(value => {
    const item = capsuleRecord(value), manifest = defineCapsule(item.manifest);
    let installation: CapsuleInstallation | null = null;
    if (item.installation !== null) {
      const i = capsuleRecord(item.installation);
      if (i.id !== manifest.id || typeof i.enabled !== 'boolean') invalid();
      installation = { id: manifest.id, version: version(i.version), enabled: i.enabled,
        grants: grants(i.grants), config: capsuleConfig(i.config), updatedAt: capsuleRevision(i.updatedAt) };
    }
    return { manifest, installation };
  });
  if (new Set(items.map(i => i.manifest.id)).size !== items.length) invalid();
  const audit = r.audit.map(value => {
    const a = capsuleRecord(value);
    if (a.actor !== ownerId || typeof a.enabled !== 'boolean') invalid();
    const rev = capsuleRevision(a.revision); if (rev > revision || rev === 0) invalid();
    return { commandId: capsuleText(a.commandId), capsuleId: capsuleId(a.capsuleId), revision: rev,
      actor: ownerId, at: capsuleRevision(a.at), enabled: a.enabled, version: version(a.version) };
  });
  return { tenantId: tenant, ownerId, revision, items, audit };
}
export function parseCapsuleReceipt(value: unknown, tenant: string, input: CapsuleCommand): void {
  const r = capsuleRecord(value), i = capsuleRecord(r.installation);
  if (r.tenantId !== tenant || r.revision !== input.expectedRevision + 1 || i.id !== input.capsuleId ||
      i.version !== input.version || i.enabled !== input.enabled ||
      JSON.stringify(grants(i.grants)) !== JSON.stringify(input.grants) ||
      JSON.stringify(capsuleConfig(i.config)) !== JSON.stringify(input.config)) invalid();
  capsuleRevision(i.updatedAt);
}
export function parseClientSummary(value: unknown, tenant: string, id: string): ClientSummary {
  const r = capsuleRecord(value), c = capsuleRecord(r.counts);
  if (r.tenantId !== tenant || r.capsuleId !== id || typeof r.truncated !== 'boolean' || !Array.isArray(r.contacts) || r.contacts.length > 50) invalid();
  const contacts = r.contacts.map(value => {
    const v = capsuleRecord(value);
    if (typeof v.relationship !== 'string' || !['client', 'prospect'].includes(v.relationship) || typeof v.phone !== 'string' || v.phone.length > 100 || /[\u0000-\u001f\u007f]/.test(v.phone)) invalid();
    return { id: capsuleText(v.id, 100), name: capsuleText(v.name, 200), phone: v.phone, relationship: v.relationship as 'client' | 'prospect' };
  });
  if (new Set(contacts.map(c => c.id)).size !== contacts.length) invalid();
  return { capsuleId: id, version: version(r.version), installationRevision: capsuleRevision(r.installationRevision),
    crmRevision: capsuleRevision(r.crmRevision), title: capsuleText(r.title, 80), truncated: r.truncated,
    contacts, counts: { contacts: capsuleRevision(c.contacts), leads: capsuleRevision(c.leads), pending: capsuleRevision(c.pending), overdue: capsuleRevision(c.overdue) } };
}
/** A projection of already-authorized CRM data; never writes or marks anything sent. */
export function projectClientSummary(view: CrmView, installation: CapsuleInstallation, revision: number): ClientSummary {
  if (!installation.enabled || installation.grants[0] !== 'database.query') throw new CapsuleError('CAPSULE_DISABLED');
  const candidates = view.contacts.filter(c => c.status === 'active' &&
    (installation.config.relationship === 'all' || c.relationship === installation.config.relationship));
  return { capsuleId: installation.id, version: installation.version, installationRevision: revision,
    crmRevision: view.revision, title: installation.config.title, counts: { ...view.counts },
    contacts: candidates.slice(0, installation.config.limit).map(({ id, name, phone, relationship }) => ({ id, name, phone, relationship })),
    truncated: view.contactsTruncated || candidates.length > installation.config.limit };
}
export function capsuleRoute(id: string): string { return '#capsule-' + capsuleId(id); }
