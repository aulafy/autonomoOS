import type { WorkspaceClient } from './workspace-client.js';
import { exportSpaceRecipe, parseSpaceRecipe, parseSpaceCommand, spaceModules, spaceTemplates, toggleSpaceModule,
  type SpaceView, type SpaceSettings, type SpaceCommand, type SpaceModuleId } from './space-contract.js';
import './space-screen.css';

const home = document.getElementById('home-screen')!, editor = document.getElementById('space-screen')!;
let client: WorkspaceClient | null = null, view: SpaceView | null = null, generation = 0, busy = false, failure = false;
let pending: SpaceCommand | null = null;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => {
  const node = document.createElement(tag); node.textContent = text; node.className = cls; return node;
};
function link(label: string, route: string, cls = 'ui-button secondary') { const a = el('a', label, cls); a.href = route; return a; }
function button(label: string, fn: () => void) { const b = el('button', label, 'ui-button secondary'); b.type = 'button'; b.addEventListener('click', fn); return b; }
function heading(root: HTMLElement, title: string, text: string) {
  const h = el('header', '', 'space-heading'), copy = el('div'); copy.append(el('span', 'TU OFICINA · AUTÓNOMO OS', 'eyebrow'), el('h2', title), el('p', text)); h.append(copy); root.append(h); return h;
}
function updateNavigation() {
  const target = document.getElementById('space-module-nav')!; target.replaceChildren();
  const modules = view?.settings.modules ?? [];
  for (const id of modules) {
    const module = spaceModules.find(m => m.id === id)!;
    const a = link(module.name, module.route, ''); const label = el('span', module.name); a.textContent = ''; a.append(label); target.append(a);
  }
  document.getElementById('space-module-caption')!.hidden = !modules.length;
  const name = document.getElementById('space-name')!, profession = document.getElementById('space-profession')!;
  name.textContent = view?.settings.name ?? 'Mi espacio';
  profession.textContent = spaceTemplates.find(t => t.id === view?.settings.templateId)?.name ?? 'Espacio a medida';
  window.dispatchEvent(new CustomEvent('space:changed', { detail: modules.map(id => {
    const m = spaceModules.find(m => m.id === id)!; return { hash: m.route, title: m.name, icon: m.icon };
  }) }));
}
function unavailable(root: HTMLElement) {
  const notice = el('div', '', 'space-notice'); notice.setAttribute('role', failure ? 'alert' : 'status');
  notice.append(el('strong', failure ? 'No se pudo consultar tu espacio' : client ? 'Consultando tu espacio…' : 'Conecta tu espacio de trabajo'),
    el('p', failure ? 'Revisa tu conexión o sesión. Los datos anteriores no se sustituyen por ejemplos.' : 'La organización y los datos se guardan para tu usuario en esta instalación.'), link('Configurar conexión', '#settings-screen'));
  root.append(notice);
  if (client) { const refresh = button('Reintentar', () => { void load(); }); refresh.disabled = busy; root.append(refresh); }
}
function renderEditor() {
  editor.replaceChildren(); const header = heading(editor, 'Organiza tu espacio', 'Elige una base para tu profesión y adapta los módulos a tu jornada.');
  if (!view || !client) { unavailable(editor); return; }
  header.append(button('Exportar organización guardada', () => {
    if (!view) return;
    const url = URL.createObjectURL(new Blob([exportSpaceRecipe(view.settings)], { type: 'application/json' }));
    const a = el('a'); a.href = url; a.download = 'AUTONOMO_OS_ORGANIZACION.json'; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  let draft = structuredClone(view.settings); const revision = view.revision, ticket = generation, session = client;
  const form = el('form', '', 'space-form'), field = el('label', 'Nombre del espacio'), name = el('input');
  name.setAttribute('aria-label', 'Nombre del espacio'); name.value = draft.name; name.required = true; name.maxLength = 80; field.append(name); form.append(field);
  form.append(el('h3', 'Una base para empezar'), el('p', 'La plantilla organiza los módulos disponibles. Conectar cuentas y aprobar acciones sigue siendo una decisión independiente.', 'space-copy'));
  const templates = el('div', '', 'space-template-grid'), choices = new Map<string, HTMLButtonElement>();
  const rows = el('div', '', 'space-module-picker');
  function templateState() { for (const [id, b] of choices) b.setAttribute('aria-pressed', String(draft.templateId === id)); }
  function renderRows() {
    rows.replaceChildren(); templateState();
    // Enabled modules first, in the saved order; disabled modules keep the catalog order.
    const ids = [...draft.modules, ...spaceModules.filter(m => !draft.modules.includes(m.id)).map(m => m.id)];
    for (const id of ids) {
      const module = spaceModules.find(m => m.id === id)!, row = el('div', '', 'space-module-option'), label = el('label'), box = el('input');
      box.type = 'checkbox'; box.checked = draft.modules.includes(id); box.disabled = busy; box.setAttribute('aria-label', `Mostrar ${module.name}`);
      const copy = el('span'); copy.append(el('strong', module.name), el('small', module.description)); label.append(box, copy); row.append(label);
      box.addEventListener('change', () => { draft.modules = toggleSpaceModule(draft.modules, id, box.checked); draft.templateId = 'custom'; renderRows(); });
      if (box.checked) {
        const position = draft.modules.indexOf(id), controls = el('div', '', 'space-order-actions');
        for (const [offset, text] of [[-1, 'Subir'], [1, 'Bajar']] as const) {
          const b = button(text, () => { const next = position + offset; [draft.modules[position], draft.modules[next]] = [draft.modules[next]!, draft.modules[position]!]; draft.templateId = 'custom'; renderRows(); });
          b.setAttribute('aria-label', `${text} ${module.name}`); b.disabled = busy || position + offset < 0 || position + offset >= draft.modules.length; controls.append(b);
        }
        row.append(controls);
      }
      rows.append(row);
    }
  }
  for (const template of spaceTemplates) {
    const b = el('button', '', 'space-template'); b.type = 'button'; b.setAttribute('aria-label', template.name);
    b.append(el('strong', template.name), el('span', template.description)); choices.set(template.id, b);
    b.addEventListener('click', () => { if (busy) return; draft = { name: name.value, templateId: template.id, modules: [...template.modules] }; renderRows(); }); templates.append(b);
  }
  form.append(templates, el('h3', 'Tus módulos, en tu orden'), el('p', 'Quitar Clientes también quita Seguimientos de la navegación, porque comparten el CRM. Puedes volver a mostrarlos.', 'space-copy'), rows);
  form.append(el('div', 'Revisión y Centro de agentes permanecen accesibles. Quitar un acceso no cancela trabajos, borra datos ni desconecta cuentas.', 'space-notice'));
  const feedback = el('p', '', 'space-error'); feedback.setAttribute('role', 'alert');
  const recipeLabel = el('label', 'Cargar una organización (.json)'), recipe = el('input');
  recipe.type = 'file'; recipe.accept = '.json,application/json'; recipe.setAttribute('aria-label', 'Cargar organización desde archivo'); recipeLabel.append(recipe);
  form.append(recipeLabel, el('p', 'Puedes adaptar el archivo exportado con Claude / Codex. Cargarlo solo prepara un borrador: revisa los módulos y guarda para aplicarlo.', 'space-copy'));
  recipe.addEventListener('change', async () => {
    const file = recipe.files?.[0]; if (!file || busy) return;
    try {
      if (file.size > 8192) throw new Error('RECIPE_TOO_LARGE');
      const imported = parseSpaceRecipe(await file.text());
      if (ticket !== generation || session !== client || busy) return;
      draft = imported; name.value = draft.name; pending = null; renderRows();
      feedback.textContent = 'Organización cargada como borrador. Revisa los módulos y pulsa Guardar mi espacio para aplicarla.';
    } catch {
      if (ticket === generation && session === client) feedback.textContent = 'El archivo no es una organización válida. Comprueba su formato, módulos y tamaño máximo de 8 KB.';
    }
  });
  const actions = el('div', '', 'space-actions'), save = el('button', 'Guardar mi espacio', 'ui-button primary'); save.type = 'submit';
  actions.append(link('Ver mi jornada', '#home-screen'), save); form.append(feedback, actions); editor.append(form); renderRows();
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || ticket !== generation || session !== client) return;
    let input: SpaceCommand;
    try {
      const proposed = parseSpaceCommand({ ...draft, name: name.value, commandId: 'candidate', expectedRevision: revision });
      input = pending && JSON.stringify({ ...pending, commandId: 'candidate' }) === JSON.stringify(proposed)
        ? pending : { ...proposed, commandId: crypto.randomUUID() }; pending = input;
    } catch { feedback.textContent = 'Comprueba el nombre y las dependencias de los módulos.'; return; }
    busy = true; const controls = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')];
    const disabled = new Map(controls.map(control => [control, control.disabled]));
    for (const control of controls) control.disabled = true; feedback.textContent = 'Guardando tu organización…';
    try {
      const result = await session.configureSpace(input);
      if (ticket !== generation || session !== client) return;
      view = result; pending = null; busy = false; updateNavigation(); renderEditor(); void renderHome();
      const saved = el('p', 'Tu espacio se ha guardado.', 'space-success'); saved.setAttribute('role', 'status'); editor.querySelector('.space-heading')!.after(saved);
    } catch {
      if (ticket !== generation || session !== client) return;
      feedback.textContent = 'No se pudo confirmar el cambio. Reintenta la misma petición. Si otra sesión modificó el espacio, recarga antes de editar.';
    } finally {
      if (ticket === generation) { busy = false; for (const control of controls) control.disabled = disabled.get(control)!; }
    }
  });
  const history = el('section', '', 'space-history'); history.append(el('h3', 'Historial de organización'));
  for (const decision of view.history) history.append(el('p', `Revisión ${decision.revision} · ${decision.settings.name} · ${decision.settings.modules.length} módulos · ${new Date(decision.at).toLocaleString('es-ES')}`));
  if (!view.history.length) history.append(el('p', 'Todavía utilizas la organización inicial. Guarda para personalizarla.')); editor.append(history);
  const reload = button('Actualizar organización', () => { if (!busy) { pending = null; void load(); } }); reload.disabled = busy; editor.append(reload);
}
async function renderHome() {
  const ticket = generation, session = client, current = view;
  home.replaceChildren(); heading(home, 'Mi jornada', current ? `${current.settings.name} · Tu actividad, organizada para hoy.` : 'Tu actividad, organizada para hoy.').append(link('Organizar mi espacio', '#space-screen'));
  if (!current || !session) { unavailable(home); return; }
  const data = el('div'); data.setAttribute('aria-live', 'polite'); data.textContent = 'Consultando tu actividad…'; home.append(data);
  const [crm, review] = await Promise.allSettled([
    current.settings.modules.includes('crm') ? session.crm() : Promise.resolve(null), session.reviewQueue({ limit: 5 })
  ]);
  if (ticket !== generation || session !== client || current !== view || !data.isConnected) return;
  data.replaceChildren(); const metrics = el('div', '', 'space-metrics');
  const metric = (label: string, value: number | null, route: string, text: string) => { const a = link('', route, 'space-metric'); a.append(el('span', label), el('strong', value === null ? '—' : String(value)), el('small', text)); metrics.append(a); };
  const counts = crm.status === 'fulfilled' ? crm.value?.counts : null;
  if (current.settings.modules.includes('crm')) metric('Contactos activos', counts?.contacts ?? null, '#clients-screen', counts ? 'CRM local' : 'Lectura no disponible');
  if (current.settings.modules.includes('followups')) metric('Seguimientos pendientes', counts?.pending ?? null, '#tasks-screen', counts ? `${counts.overdue} vencidos` : 'Lectura no disponible');
  const reviews = review.status === 'fulfilled' ? review.value : null;
  metric('Trabajos que requieren atención', reviews?.matchedTotal ?? null, '#review-queue', reviews ? 'Cola completa del profesional' : 'Lectura no disponible');
  metric('Resultados inciertos', reviews?.counts.uncertain ?? null, '#review-queue', reviews ? 'Necesitan observación antes de continuar' : 'Lectura no disponible'); data.append(metrics);
  if (crm.status === 'rejected' || review.status === 'rejected') { const warning = el('p', 'No se pudo leer parte de tu actividad. Los valores sin verificar se muestran con —. Actualiza o comprueba la conexión.', 'space-error'); warning.setAttribute('role', 'alert'); data.append(warning); }
  const modules = el('div', '', 'space-work-grid');
  for (const id of current.settings.modules) {
    const module = spaceModules.find(m => m.id === id)!, card = link('', module.route, 'space-work-card'); card.append(el('span', 'MÓDULO DE TU ESPACIO', 'eyebrow'), el('h3', module.name), el('p', module.description), el('strong', 'Abrir →')); modules.append(card);
  }
  if (!current.settings.modules.length) modules.append(el('p', 'Tu espacio no tiene módulos opcionales. Añádelos cuando los necesites.', 'space-notice')); data.append(modules);
  const next = el('section', '', 'space-next'); next.append(el('h3', 'Trabajo que requiere tu atención'));
  if (reviews) {
    for (const row of reviews.items) { const a = link('', '#review-queue', 'space-review-row'); a.append(el('strong', row.contactName ?? row.title), el('span', row.status === 'uncertain' ? 'Resultado incierto · reconciliar' : row.status === 'approval' ? 'Pendiente de aprobación' : 'Revisar trabajo')); next.append(a); }
    if (!reviews.items.length) next.append(el('p', 'No hay trabajos pendientes de atención en la cola de revisión.'));
  } else next.append(el('p', 'La cola de revisión no está disponible. No se puede confirmar que no haya pendientes.'));
  next.append(link('Abrir revisión completa', '#review-queue')); data.append(next);
  const customize = el('div', '', 'space-customize'); customize.append(el('strong', 'Adapta tu oficina a tu forma de trabajar'), el('p', 'Añade cápsulas o crea variantes con los contratos del proyecto.'), link('Ver cápsulas', '#capsules-screen')); data.append(customize);
  data.append(button('Actualizar mi jornada', () => { void load(); }));
}
async function load() {
  if (busy) return;
  const session = client, ticket = ++generation; view = null; failure = false; updateNavigation(); renderEditor(); void renderHome();
  if (!session) return;
  try { const result = await session.space(); if (ticket !== generation || session !== client) return; view = result; }
  catch { if (ticket !== generation || session !== client) return; failure = true; }
  updateNavigation(); renderEditor(); void renderHome();
}
export function setSpaceClient(value: WorkspaceClient | null) { generation++; client = value; busy = false; pending = null; void load(); }
window.addEventListener('hashchange', () => { if (['#home-screen', '#space-screen'].includes(location.hash) && !busy) void load(); });
renderEditor(); void renderHome();
