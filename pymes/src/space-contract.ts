import { capsuleRecord, capsuleText, capsuleRevision, CapsuleError } from './capsule-sdk.js';

export type SpaceModuleId = 'gmail' | 'crm' | 'followups';
export type SpaceTemplateId = 'general' | 'consulting' | 'insurance' | 'custom';
export interface SpaceModule {
  id: SpaceModuleId; name: string; description: string; route: string;
  dependencies: SpaceModuleId[]; icon: string;
}
export const spaceModules: readonly SpaceModule[] = [
  { id: 'gmail', name: 'Correo Gmail', description: 'Tu bandeja local, preparación de respuestas y revisión antes de enviar.', route: '#gmail-inbox', dependencies: [], icon: 'mail' },
  { id: 'crm', name: 'Clientes', description: 'Contactos, oportunidades y contexto de las conversaciones.', route: '#clients-screen', dependencies: [], icon: 'users' },
  { id: 'followups', name: 'Seguimientos', description: 'Próximos pasos y tareas pendientes del CRM local.', route: '#tasks-screen', dependencies: ['crm'], icon: 'check' }
];
export const spaceTemplates = [
  { id: 'general', name: 'Profesional independiente', description: 'Correo, clientes y seguimiento para organizar tu actividad.', modules: ['gmail', 'crm', 'followups'] },
  { id: 'consulting', name: 'Consultoría y servicios', description: 'Primero tus clientes y próximos pasos; después el correo.', modules: ['crm', 'followups', 'gmail'] },
  { id: 'insurance', name: 'Agencia de seguros', description: 'Base de correo y cartera de clientes. Cotización y renovaciones se añadirán como cápsulas.', modules: ['gmail', 'crm', 'followups'] }
] as const;
export interface SpaceSettings { name: string; templateId: SpaceTemplateId; modules: SpaceModuleId[]; }
export interface SpaceCommand extends SpaceSettings { commandId: string; expectedRevision: number; }
export interface SpaceDecision { commandId: string; actor: string; at: number; revision: number; settings: SpaceSettings; }
export interface SpaceView { tenantId: string; ownerId: string; revision: number; configured: boolean; settings: SpaceSettings; history: SpaceDecision[]; }
export const defaultSpace = (): SpaceSettings => ({ name: 'Mi espacio', templateId: 'general', modules: ['gmail', 'crm', 'followups'] });
function invalid(): never { throw new CapsuleError('SPACE_INVALID_INPUT'); }
function exact(r: Record<string, unknown>, names: string[]) { if (Object.keys(r).sort().join(',') !== names.sort().join(',')) invalid(); }
export function parseSpaceSettings(raw: unknown): SpaceSettings {
  const r = capsuleRecord(raw); exact(r, ['name', 'templateId', 'modules']);
  const name = capsuleText(r.name, 80);
  if (typeof r.templateId !== 'string' || !['general', 'consulting', 'insurance', 'custom'].includes(r.templateId) ||
    !Array.isArray(r.modules) || r.modules.length > spaceModules.length ||
    r.modules.some(id => !spaceModules.some(m => m.id === id)) || new Set(r.modules).size !== r.modules.length) invalid();
  const modules = r.modules as SpaceModuleId[];
  if (modules.some(id => spaceModules.find(m => m.id === id)!.dependencies.some(d => !modules.includes(d)))) throw new CapsuleError('SPACE_DEPENDENCY_REQUIRED');
  return { name, templateId: r.templateId as SpaceTemplateId, modules: [...modules] };
}
export function parseSpaceCommand(raw: unknown): SpaceCommand {
  const r = capsuleRecord(raw); exact(r, ['name', 'templateId', 'modules', 'commandId', 'expectedRevision']);
  const commandId = capsuleText(r.commandId, 100); if (!/^[a-zA-Z0-9_-]+$/.test(commandId)) invalid();
  return { commandId, expectedRevision: capsuleRevision(r.expectedRevision), ...parseSpaceSettings({ name: r.name, templateId: r.templateId, modules: r.modules }) };
}
export function parseSpaceView(raw: unknown, tenant: string): SpaceView {
  const r = capsuleRecord(raw); exact(r, ['tenantId', 'ownerId', 'revision', 'configured', 'settings', 'history']);
  if (r.tenantId !== tenant || typeof r.configured !== 'boolean' || !Array.isArray(r.history) || r.history.length > 30) invalid();
  const ownerId = capsuleText(r.ownerId, 200), revision = capsuleRevision(r.revision), settings = parseSpaceSettings(r.settings);
  if ((revision === 0) !== !r.configured) invalid();
  let previous = revision + 1;
  const history = r.history.map(raw => {
    const a = capsuleRecord(raw); exact(a, ['commandId', 'actor', 'at', 'revision', 'settings']);
    const rev = capsuleRevision(a.revision); if (a.actor !== ownerId || rev === 0 || rev >= previous) invalid(); previous = rev;
    return { commandId: capsuleText(a.commandId), actor: ownerId, at: capsuleRevision(a.at), revision: rev, settings: parseSpaceSettings(a.settings) };
  });
  if (revision > 0 && (history[0]?.revision !== revision || JSON.stringify(history[0].settings) !== JSON.stringify(settings))) invalid();
  if (revision === 0 && history.length) invalid();
  return { tenantId: tenant, ownerId, revision, configured: r.configured, settings, history };
}
export function parseSpaceReceipt(raw: unknown, tenant: string, input: SpaceCommand): void {
  const r = capsuleRecord(raw); exact(r, ['tenantId', 'ownerId', 'revision', 'settings']);
  capsuleText(r.ownerId, 200);
  if (r.tenantId !== tenant || r.revision !== input.expectedRevision + 1 ||
    JSON.stringify(parseSpaceSettings(r.settings)) !== JSON.stringify({ name: input.name, templateId: input.templateId, modules: input.modules })) invalid();
}
/** Portable organization only: no owner, tenant, history, credentials or connector grants. */
export function exportSpaceRecipe(settings: SpaceSettings): string {
  return JSON.stringify({ schemaVersion: 1, settings: parseSpaceSettings(settings) }, null, 2) + '\n';
}
export function parseSpaceRecipe(text: string): SpaceSettings {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 8192) invalid();
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { invalid(); }
  const r = capsuleRecord(parsed); exact(r, ['schemaVersion', 'settings']); if (r.schemaVersion !== 1) invalid();
  return parseSpaceSettings(r.settings);
}
/** Dependency-aware selection used by the editor. Order is part of the user's configuration. */
export function toggleSpaceModule(ids: SpaceModuleId[], id: SpaceModuleId, enabled: boolean): SpaceModuleId[] {
  if (!spaceModules.some(m => m.id === id)) invalid();
  let result = [...ids];
  if (enabled) {
    for (const dependency of spaceModules.find(m => m.id === id)!.dependencies) if (!result.includes(dependency)) result.push(dependency);
    if (!result.includes(id)) result.push(id);
  } else {
    result = result.filter(value => value !== id && !spaceModules.find(m => m.id === value)!.dependencies.includes(id));
  }
  return result;
}
