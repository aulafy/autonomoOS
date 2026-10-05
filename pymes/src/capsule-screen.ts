import type { WorkspaceClient } from './workspace-client.js';
import { clientSummaryCapsule } from './capsule-registry.js';
import { capsuleConfig, capsuleRoute, type CapsuleCatalog, type CapsuleCommand, type CapsuleManifest, type ClientSummary } from './capsule-sdk.js';
import { capsuleDevelopmentKit } from './capsule-kit.js';
import sdkSource from './capsule-sdk.ts?raw';
import crmContracts from './crm-contract.ts?raw';
import './capsule-screen.css';

const root = document.getElementById('capsules-screen')!, page = document.getElementById('capsule-view-screen')!;
const dialog = document.getElementById('capsule-dialog') as HTMLDialogElement;
let client: WorkspaceClient | null = null, catalog: CapsuleCatalog | null = null, epoch = 0, busy = false;
let failure = '', activeCommand: CapsuleCommand | null = null;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
  const n = document.createElement(tag); n.textContent = text; n.className = cls; return n;
};
function action(label: string, run: () => void, cls = 'ui-button secondary') {
  const b = el('button', label, cls); b.type = 'button'; b.addEventListener('click', run); return b;
}
function badge(text: string, cls = '') { return el('span', text, `capsule-badge ${cls}`); }
function navigation() {
  const target = document.getElementById('capsule-nav')!; target.replaceChildren();
  for (const item of catalog?.items ?? []) if (item.installation?.enabled && item.installation.version === item.manifest.version) {
    const a = el('a'); a.href = capsuleRoute(item.manifest.id);
    a.append(el('span', '▦', 'capsule-nav-icon'), el('span', item.installation.config.title)); target.append(a);
  }
  document.getElementById('capsule-nav-caption')!.hidden = !target.childElementCount;
  window.dispatchEvent(new CustomEvent('capsules:changed', { detail: (catalog?.items ?? []).map(i => ({
    hash: capsuleRoute(i.manifest.id), title: i.installation?.config.title ?? i.manifest.name, enabled: !!i.installation?.enabled && i.installation.version === i.manifest.version })) }));
}
function heading(target: HTMLElement, eyebrow: string, title: string, description: string) {
  const header = el('div', '', 'capsule-heading'), copy = el('div');
  copy.append(el('span', eyebrow, 'eyebrow'), el('h2', title), el('p', description)); header.append(copy); target.append(header); return header;
}
function kit() {
  const text = capsuleDevelopmentKit(clientSummaryCapsule, sdkSource, crmContracts);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = el('a'); a.href = url; a.download = 'KIT_CAPSULA_AUTONOMO_OS.md'; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function summary(target: HTMLElement, view: ClientSummary, synthetic = false) {
  if (synthetic) target.append(el('p', 'Ejemplo con datos ficticios. No lee ni modifica tu CRM.', 'capsule-notice'));
  const counts = el('div', '', 'capsule-metrics');
  for (const [label, count] of [['Contactos activos', view.counts.contacts], ['Oportunidades abiertas', view.counts.leads],
      ['Seguimientos pendientes', view.counts.pending], ['Vencidos', view.counts.overdue]] as const) {
    const metric = el('div'); metric.append(el('span', label), el('strong', String(count))); counts.append(metric);
  }
  target.append(counts);
  const rows = el('div', '', 'capsule-contacts');
  for (const c of view.contacts) {
    const row = el('article', '', 'capsule-contact'), copy = el('div');
    copy.append(el('strong', c.name), el('small', c.phone || 'Sin teléfono registrado'));
    row.append(el('span', c.name.slice(0, 2).toLocaleUpperCase('es'), 'capsule-avatar'), copy,
      badge(c.relationship === 'client' ? 'Cliente' : 'Prospecto')); rows.append(row);
  }
  if (!view.contacts.length) rows.append(el('p', 'No hay contactos activos que coincidan con esta configuración.', 'capsule-empty'));
  target.append(rows, el('p', view.truncated
    ? 'Vista limitada. Los totales pertenecen al CRM completo; el filtro se aplica a los contactos disponibles en su listado (hasta 200).'
    : 'Solo lectura del CRM local. Los totales pertenecen al CRM completo.', 'capsule-footnote'));
}
function preview(manifest: CapsuleManifest) {
  if (busy) return; dialog.replaceChildren();
  dialog.append(el('span', 'VISTA PREVIA · DATOS SINTÉTICOS', 'eyebrow'), el('h2', manifest.defaults.title));
  summary(dialog, { capsuleId: manifest.id, version: manifest.version, installationRevision: 0, crmRevision: 0,
    title: manifest.defaults.title, counts: { contacts: 3, leads: 2, pending: 4, overdue: 1 }, truncated: false,
    contacts: [{ id: 'example-a', name: 'Estudio Oliva · ejemplo', phone: '', relationship: 'client' },
      { id: 'example-b', name: 'Marina Ruiz · ejemplo', phone: '', relationship: 'prospect' },
      { id: 'example-c', name: 'Taller Norte · ejemplo', phone: '', relationship: 'client' }] }, true);
  const actions = el('div', '', 'capsule-actions'); actions.append(action('Cerrar', () => dialog.close())); dialog.append(actions); dialog.showModal();
}
function configure(id: string, disable = false) {
  const item = catalog?.items.find(i => i.manifest.id === id); if (!item || !client || busy) return;
  const current = item.installation?.config ?? item.manifest.defaults, expectedRevision = catalog!.revision;
  dialog.replaceChildren(); activeCommand = null;
  dialog.append(el('span', 'CONFIGURACIÓN DE CÁPSULA', 'eyebrow'), el('h2', item.manifest.name),
    el('p', 'Solo lee contactos, oportunidades y seguimientos del CRM local. No permite enviar mensajes ni editar clientes.'));
  const form = el('form', '', 'capsule-form');
  const field = (label: string, node: HTMLElement) => { const l = el('label', label); node.setAttribute('aria-label', label); l.append(node); form.append(l); };
  const title = el('input'); title.value = current.title; title.required = true; title.maxLength = 80; field('Nombre en mi espacio', title);
  const limit = el('input'); limit.type = 'number'; limit.min = '1'; limit.max = '50'; limit.required = true; limit.value = String(current.limit); field('Contactos que mostrar (1–50)', limit);
  const relationship = el('select');
  for (const [value, label] of [['all', 'Todos'], ['client', 'Clientes'], ['prospect', 'Prospectos']]) { const o = el('option', label); o.value = value; relationship.append(o); }
  relationship.value = current.relationship; field('Relación', relationship);
  const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = !disable; field('Activar en mi espacio', enabled);
  const consent = el('input'); consent.type = 'checkbox'; consent.checked = !!item.installation;
  field('Autorizar lectura del CRM local para esta cápsula', consent);
  form.append(el('p', 'Desactivar conserva configuración e historial. No altera los trabajos ni sus aprobaciones.', 'capsule-footnote'));
  const feedback = el('p', '', 'capsule-error'); feedback.setAttribute('role', 'alert'); form.append(feedback);
  const actions = el('div', '', 'capsule-actions'), cancel = action('Volver', () => dialog.close()), save = el('button', disable ? 'Desactivar cápsula' : 'Guardar configuración', 'ui-button primary'); save.type = 'submit';
  actions.append(cancel, save); form.append(actions); dialog.append(form); dialog.showModal();
  const sessionEpoch = epoch, sessionClient = client;
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || sessionEpoch !== epoch || client !== sessionClient) return;
    if (!consent.checked) { feedback.textContent = 'Debes autorizar la lectura del CRM local.'; return; }
    let command: CapsuleCommand;
    try {
      const config = capsuleConfig({ title: title.value, limit: Number(limit.value), relationship: relationship.value });
      const proposed = { capsuleId: id, version: item.manifest.version, enabled: enabled.checked, grants: ['database.query'] as ['database.query'], config, expectedRevision };
      command = activeCommand && JSON.stringify({ ...activeCommand, commandId: '' }) === JSON.stringify({ ...proposed, commandId: '' })
        ? activeCommand : { ...proposed, commandId: crypto.randomUUID() };
      activeCommand = command;
    } catch { feedback.textContent = 'Comprueba el nombre, el filtro y el límite de contactos.'; return; }
    busy = true; save.disabled = true; cancel.disabled = true; feedback.textContent = '';
    try {
      const result = await sessionClient.configureCapsule(command);
      if (epoch !== sessionEpoch || client !== sessionClient) return;
      catalog = result; activeCommand = null; busy = false; dialog.close(); failure = ''; render(); navigation(); void loadView();
    } catch {
      if (epoch !== sessionEpoch || client !== sessionClient) return;
      feedback.textContent = 'No se pudo confirmar el cambio. Puedes reintentar la misma petición; si otra sesión cambió la configuración, cierra y actualiza la vista.';
    } finally { if (epoch === sessionEpoch) { busy = false; save.disabled = false; cancel.disabled = false; } }
  });
}
function render() {
  root.replaceChildren();
  const header = heading(root, 'MI ESPACIO · CÁPSULAS', 'Tu Autónomo OS, a tu medida', 'Añade funciones a tu espacio y adapta cada una a tu forma de trabajar.');
  const compose = el('a', 'Organizar mi espacio', 'ui-button secondary'); compose.href = '#space-screen';
  header.append(compose, action('Crear con Claude / Codex ↗', kit));
  if (failure || !client) {
    const notice = el('div', '', 'capsule-notice'); notice.setAttribute('role', failure ? 'alert' : 'status');
    notice.append(el('strong', failure ? 'No se pudo consultar tu espacio' : 'Conecta un espacio para empezar'),
      el('p', failure ? 'La configuración no se ha sustituido por datos de ejemplo. Actualiza o comprueba tu sesión.' : 'La vista previa y el kit están disponibles. Para activar una cápsula necesitas una sesión autorizada.'));
    const a = el('a', 'Configurar conexión →'); a.href = '#settings-screen'; notice.append(a); root.append(notice);
  }
  const grid = el('div', '', 'capsule-grid');
  const items = catalog?.items ?? [{ manifest: clientSummaryCapsule, installation: null }];
  for (const item of items) {
    const card = el('article', '', 'capsule-card'), installed = item.installation, compatible = installed?.version === item.manifest.version;
    const top = el('div', '', 'capsule-card-top'); top.append(el('span', '♙', 'capsule-icon'), badge(installed?.enabled && compatible ? 'Activa' : installed ? compatible ? 'Desactivada' : 'Actualización disponible' : 'Disponible', installed?.enabled && compatible ? 'active' : ''));
    card.append(top, el('h3', item.manifest.name), el('p', item.manifest.description),
      el('small', `Versión ${item.manifest.version} · ${item.manifest.author} · Solo lectura`));
    const permission = el('div', '', 'capsule-permission'); permission.append(el('strong', 'CRM local'), el('span', 'Contactos y resumen de próximos pasos')); card.append(permission);
    if (installed) card.append(el('p', `${installed.config.title} · ${installed.config.limit} contactos · ${installed.config.relationship === 'all' ? 'Todas las relaciones' : installed.config.relationship === 'client' ? 'Clientes' : 'Prospectos'}`, 'capsule-footnote'));
    const actions = el('div', '', 'capsule-actions'); actions.append(action('Vista previa', () => preview(item.manifest)));
    const config = action(installed ? 'Configurar' : 'Añadir a mi espacio', () => configure(item.manifest.id), 'ui-button primary'); config.disabled = !client || !!failure || !catalog || busy; actions.append(config);
    if (installed?.enabled && compatible) { const a = el('a', 'Abrir →', 'ui-button secondary'); a.href = capsuleRoute(item.manifest.id); actions.append(a);
      const disable = action('Desactivar', () => configure(item.manifest.id, true)); disable.disabled = busy; actions.append(disable); }
    card.append(actions); grid.append(card);
  }
  root.append(grid);
  const next = el('div', '', 'capsule-roadmap'); next.append(el('span', 'PRÓXIMAS CONEXIONES', 'eyebrow'), el('h3', 'Las mismas cápsulas, conectadas a tus herramientas'), el('p', 'Telegram dispone de recepción Bot API en instalaciones habilitadas. WhatsApp, Odoo y WordPress siguen pendientes.'));
  for (const label of ['WhatsApp', 'Odoo', 'WordPress']) next.append(badge(`${label} · En preparación`)); const telegram = el('a', 'Configurar Telegram →', 'ui-button secondary'); telegram.href = '#telegram-screen'; next.append(telegram); root.append(next);
  const history = el('section', '', 'capsule-history'); history.append(el('h3', 'Cambios de mi espacio'));
  for (const audit of catalog?.audit ?? []) history.append(el('p', `${audit.enabled ? 'Activada / configurada' : 'Desactivada'} · ${audit.capsuleId} · revisión ${audit.revision} · ${new Date(audit.at).toLocaleString('es-ES')}`));
  if (!catalog?.audit.length) history.append(el('p', 'Todavía no hay cambios guardados.')); root.append(history);
  const refresh = action('Actualizar mi espacio', () => { void load(); }); refresh.disabled = !client || busy; root.append(refresh);
}
async function load() {
  const current = client, ticket = ++epoch; if (!current) { catalog = null; failure = ''; render(); navigation(); return; }
  catalog = null; failure = ''; navigation(); render(); page.replaceChildren();
  try { const result = await current.capsules(); if (ticket !== epoch || current !== client) return; catalog = result; }
  catch { if (ticket !== epoch) return; failure = 'CAPSULE_LOAD_FAILED'; catalog = null; }
  render(); navigation(); void loadView();
}
async function loadView() {
  if (!location.hash.startsWith('#capsule-')) return;
  const ticket = epoch, hash = location.hash, current = client;
  page.replaceChildren(); const item = catalog?.items.find(i => capsuleRoute(i.manifest.id) === hash);
  heading(page, 'CÁPSULA · CRM LOCAL', item?.installation?.config.title ?? 'Resumen de clientes', 'Una vista de lectura configurada para tu espacio.');
  const controls = el('div', '', 'capsule-actions'), back = el('a', '← Mi Autónomo OS', 'ui-button secondary'); back.href = '#capsules-screen'; controls.append(back); page.append(controls);
  if (!current || !item?.installation?.enabled || item.installation.version !== item.manifest.version) {
    page.append(el('p', 'Esta cápsula no está disponible en tu sesión. Revisa la conexión y su activación.', 'capsule-notice')); return;
  }
  const content = el('div'); content.setAttribute('aria-live', 'polite'); content.textContent = 'Consultando CRM local…'; page.append(content);
  try {
    const result = await current.capsuleView(item.manifest.id);
    if (ticket !== epoch || location.hash !== hash || current !== client || !content.isConnected) return;
    if (result.installationRevision !== catalog?.revision || result.version !== item.manifest.version) throw new Error('CAPSULE_CHANGED');
    content.replaceChildren(); summary(content, result);
    const crm = el('a', 'Abrir directorio completo →', 'ui-button secondary'); crm.href = '#clients-screen'; content.append(crm);
  } catch {
    if (ticket !== epoch || location.hash !== hash || current !== client || !content.isConnected) return;
    content.replaceChildren(el('p', 'No se pudo leer el CRM. No se muestran datos de ejemplo. Actualiza el espacio para comprobar su configuración.', 'capsule-error'));
  }
}
export function setCapsuleClient(value: WorkspaceClient | null): void {
  epoch++; client = value; busy = false; activeCommand = null; catalog = null; dialog.close(); page.replaceChildren(); void load();
}
window.addEventListener('hashchange', () => { if (location.hash === '#capsules-screen' && client && !busy) void load(); else void loadView(); });
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
render();
