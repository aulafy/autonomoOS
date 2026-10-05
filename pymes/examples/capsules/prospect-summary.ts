import { defineCapsule } from '../../src/capsule-sdk.js';

/** Reviewed example: reuses the host renderer and the existing authorized CRM. */
export const prospectSummary = defineCapsule({
  id: 'custom.prospect-summary',
  version: '1.0.0',
  sdkVersion: 1,
  name: 'Prospectos del estudio',
  description: 'Una vista reutilizable para revisar los prospectos del CRM local.',
  author: 'Mi organización',
  license: 'MIT',
  renderer: 'crm.contact-summary',
  capabilities: ['database.query'],
  resources: ['crm.local.contacts'],
  defaults: { title: 'Mi actividad comercial', limit: 12, relationship: 'prospect' }
});
