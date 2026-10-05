import {crmConversations, crmDeliveryLabels, crmInteractionDisplay} from './crm-conversations.js';
import { WorkspaceHttpError, type WorkspaceClient } from './workspace-client.js';
import { CRM_LINES, type CrmContact, type CrmOperation, type CrmCommandInput, type CrmView } from './crm-contract.js';
import type { CrmResolution } from './crm-view.js';
import './crm-screen.css';
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const list = byId('clients-list'), profile = byId('clients-profile'), tasks = byId('tasks-list'), search = byId<HTMLInputElement>('clients-search'), kind = byId<HTMLSelectElement>('clients-kind');
const dialog = byId<HTMLDialogElement>('crm-dialog'), dialogBody = byId('crm-dialog-body'), dialogFeedback = byId('crm-dialog-feedback');
let client: WorkspaceClient | null = null, view: CrmView | null = null, taskView: CrmView | null = null, selected: string | null = null, epoch = 0, busy = false, query = '', taskStatus: 'pending' | 'done' | 'cancelled' | 'all' = 'pending';
let loadFailed = false;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<string, CrmCommandInput>();
const lineLabels: Record<string, string> = { car: 'Coche', life: 'Vida', home: 'Hogar', professional_liability: 'RC de autónomos', other: 'Otro / por determinar' };
const statusLabels: Record<string, string> = { new: 'Nueva', contacted: 'Contactado', proposal: 'Propuesta', won: 'Ganada', lost: 'Perdida', received: 'Recibido', committed: 'Envío confirmado', unknown: 'Resultado incierto', failed: 'Fallido', note: 'Nota', pending: 'Pendiente', done: 'Hecho', cancelled: 'Cancelado' };
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined)
        n.textContent = text;
    return n;
};
function button(text: string, action: () => void, cls = 'gmail-button') { const b = node('button', cls, text); b.type = 'button'; b.disabled = busy || !client; b.addEventListener('click', () => { if (!busy)
    action(); }); return b; }
function feedback(text: string) { byId('crm-feedback').textContent = text; }
const date = (n: number) => new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(n);
function empty(n: HTMLElement, title: string, text: string) { n.replaceChildren(node('h3', '', title), node('p', '', text)); }
function showForm(title: string, build: (form: HTMLFormElement) => void) {
    if (busy || !client)
        return;
    dialogBody.replaceChildren();
    dialogFeedback.textContent = '';
    byId('crm-dialog-title').textContent = title;
    const form = node('form', 'crm-form');
    build(form);
    dialogBody.append(form);
    dialog.showModal();
    form.querySelector<HTMLInputElement>('input,textarea,select')?.focus();
}
function field(form: HTMLFormElement, name: string, label: string, value = '', type = 'text', required = false, max = 200) {
    const wrap = node('label', 'crm-field', label);
    const input = type === 'textarea' ? node('textarea', '') : node('input', '');
    input.name = name;
    input.value = value;
    input.required = required;
    input.maxLength = max;
    if (input instanceof HTMLInputElement)
        input.type = type;
    else
        input.rows = 4;
    wrap.append(input);
    form.append(wrap);
    return input;
}
function selectField(form: HTMLFormElement, name: string, label: string, values: [
    string,
    string
][], selectedValue: string) {
    const wrap = node('label', 'crm-field', label), s = node('select', '');
    s.name = name;
    for (const [value, text] of values) {
        const o = node('option', '', text);
        o.value = value;
        s.append(o);
    }
    s.value = selectedValue;
    wrap.append(s);
    form.append(wrap);
    return s;
}
function submitButton(form: HTMLFormElement, title = 'Guardar') { const b = node('button', 'gmail-button primary', title); b.type = 'submit'; form.append(b); return b; }
async function mutate(operation: CrmOperation): Promise<boolean> {
    const c = client;
    if (!c || !view || busy)
        return false;
    const key = JSON.stringify(operation);
    let command = pending.get(key);
    if (!command) {
        command = { commandId: crypto.randomUUID(), expectedRevision: view.revision, operation };
        pending.set(key, command);
    }
    busy = true;
    try {
        await c.crmCommand(command);
        if (c !== client)
            return false;
        pending.delete(key);
        feedback('Cambio guardado en el CRM local.');
        window.dispatchEvent(new Event('crm-changed'));
        return true;
    }
    catch (e) {
        if (c !== client)
            return false;
        if (e instanceof WorkspaceHttpError && e.status === 409 && e.message === 'CRM_REVISION_CONFLICT')
            pending.delete(key);
        const message = e instanceof WorkspaceHttpError && e.status === 409 ? 'Los datos cambiaron o la operación necesita revisión. Actualiza y vuelve a intentarlo.' : 'No se ha confirmado el guardado. Puedes reintentar la misma solicitud.';
        feedback(message);
        dialogFeedback.textContent = message;
        return false;
    }
    finally {
        if (c === client) {
            busy = false;
            void reload();
        }
    }
}
function contactForm(contact: CrmContact | null, preset: {
    email?: string;
    name?: string;
} = {}, after?: () => Promise<void>) {
    const id = contact?.id ?? crypto.randomUUID();
    showForm(contact ? 'Editar contacto' : 'Nuevo contacto', form => {
        const name = field(form, 'name', 'Nombre', contact?.name ?? preset.name ?? '', 'text', true), email = contact ? null : field(form, 'email', 'Email', preset.email ?? '', 'email', false, 254), phone = field(form, 'phone', 'Teléfono', contact?.phone ?? '', 'tel', false, 100), notes = field(form, 'notes', 'Notas y preparación de llamadas', contact?.notes ?? '', 'textarea', false, 2000);
        const relationship = selectField(form, 'relationship', 'Relación', [['prospect', 'Prospecto'], ['client', 'Cliente']], contact?.relationship ?? 'prospect');
        const status = contact ? selectField(form, 'status', 'Estado', [['active', 'Activo'], ['archived', 'Archivado']], contact.status) : null;
        form.append(node('p', 'crm-muted', 'El email guardado no verifica la identidad de la persona.'));
        const save = submitButton(form);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            save.disabled = true;
            const operation: CrmOperation = contact ? { type: 'contact.update', id, name: name.value, phone: phone.value, notes: notes.value, relationship: relationship.value as 'prospect' | 'client', status: status!.value as 'active' | 'archived' } : { type: 'contact.create', id, name: name.value, email: email!.value, phone: phone.value, notes: notes.value, relationship: relationship.value as 'prospect' | 'client' };
            if (await mutate(operation)) {
                selected = id;
                query = '';
                search.value = '';
                kind.value = 'all';
                dialog.close();
                await reload();
                if (after)
                    await after();
            }
            else
                save.disabled = false;
        });
    });
}
function addIdentity(contactId: string) {
    const id = crypto.randomUUID();
    showForm('Añadir email', form => {
        const email = field(form, 'email', 'Email', '', 'email', true, 254);
        const save = submitButton(form);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            save.disabled = true;
            if (await mutate({ type: 'identity.add', id, contactId, email: email.value }))
                dialog.close();
            else
                save.disabled = false;
        });
    });
}
function addLead(contactId: string) {
    const id = crypto.randomUUID();
    showForm('Nueva oportunidad', form => {
        const title = field(form, 'title', 'Descripción de la oportunidad', '', 'text', true, 300), line = selectField(form, 'line', 'Ramo', CRM_LINES.map(l => [l, lineLabels[l]!]), 'other');
        const save = submitButton(form);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            save.disabled = true;
            if (await mutate({ type: 'lead.create', id, contactId, title: title.value, line: line.value as typeof CRM_LINES[number] }))
                dialog.close();
            else
                save.disabled = false;
        });
    });
}
function addFollowUp(contactId: string) {
    const id = crypto.randomUUID();
    showForm('Programar seguimiento', form => {
        const title = field(form, 'title', 'Próxima acción', '', 'text', true, 300), due = field(form, 'due', 'Fecha y hora', '', 'datetime-local', true);
        const lead = selectField(form, 'lead', 'Oportunidad asociada', [['', 'Sin oportunidad'], ...(view?.leads ?? []).map(l => [l.id, l.title] as [
                string,
                string
            ])], '');
        const save = submitButton(form);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const dueAt = Date.parse(due.value);
            if (!Number.isFinite(dueAt)) {
                dialogFeedback.textContent = 'Indica una fecha válida.';
                return;
            }
            save.disabled = true;
            if (await mutate({ type: 'followup.create', id, contactId, leadId: lead.value || null, title: title.value, dueAt }))
                dialog.close();
            else
                save.disabled = false;
        });
    });
}
function addNote(contactId: string) {
    const id = crypto.randomUUID();
    showForm('Registrar conversación o nota', form => {
        const summary = field(form, 'summary', 'Lo acordado y los próximos pasos', '', 'textarea', true, 2000);
        const save = submitButton(form);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            save.disabled = true;
            if (await mutate({ type: 'interaction.note', id, contactId, summary: summary.value }))
                dialog.close();
            else
                save.disabled = false;
        });
    });
}
function render() {
    list.replaceChildren();
    profile.replaceChildren();
    tasks.replaceChildren();
    byId('crm-new-contact').toggleAttribute('disabled', !client || !view || busy);
    byId('crm-refresh').toggleAttribute('disabled', !client || busy);
    byId('crm-tasks-refresh').toggleAttribute('disabled', !client || busy);
    if (!client || !view) {
        byId('crm-module-contacts').textContent = '—';
        byId('crm-module-tasks').textContent = '—';
        byId('tasks-count').textContent = loadFailed ? 'CRM no disponible' : 'CRM no conectado';
        byId('clients-results').textContent = '';
        for (const key of ['contacts', 'leads', 'pending', 'overdue'])
            byId('crm-count-' + key).textContent = '—';
        empty(tasks, loadFailed ? 'CRM no disponible' : 'Conecta tu oficina', 'Los seguimientos se leen del servicio local.');
        empty(list, loadFailed ? 'CRM no disponible' : client ? 'Cargando CRM…' : 'Conecta tu oficina', 'El directorio se guarda en el servicio local del Mac.');
        empty(profile, loadFailed ? 'No se ha podido consultar el historial' : 'Tu próxima conversación, con contexto', loadFailed ? 'Comprueba el servicio local y pulsa Actualizar CRM.' : 'Contactos, oportunidades e historial aparecerán aquí.');
        return;
    }
    byId('crm-module-contacts').textContent = String(view.counts.contacts);
    byId('crm-module-tasks').textContent = String(view.counts.pending);
    for (const [key, value] of Object.entries(view.counts))
        byId('crm-count-' + key).textContent = String(value);
    byId('clients-results').textContent = `${view.totalContacts} ${view.totalContacts===1?"contacto":"contactos"}${view.contactsTruncated ? ' · mostrando hasta 200; busca para acotar' : ''} · CRM local`;
    const filtered = view.contacts.filter(c => kind.value === 'all' || kind.value === 'archived' ? kind.value === 'all' || c.status === 'archived' : c.status === 'active' && c.relationship === kind.value);
    if (selected && !filtered.some(c => c.id === selected))
        selected = null;
    for (const c of filtered) {
        const row = button(c.name, () => { selected = c.id; void reload(); }, 'client-row');
        row.setAttribute('aria-pressed', String(selected === c.id));
        row.append(node('span', '', `${c.status === 'archived' ? 'Archivado' : c.relationship === 'client' ? 'Cliente' : 'Prospecto'} · ${c.phone || 'Sin teléfono'}`));
        list.append(row);
    }
    if (!filtered.length)
        empty(list, 'Tu cartera empieza aquí', 'Crea un contacto o vincula un correo de Gmail.');
    const c = view.contacts.find(c => c.id === selected);
    if (!c || view.selectedContactId !== c.id)
        empty(profile, 'Selecciona un contacto', 'Revisa su historial, prepara llamadas y programa la siguiente acción.');
    else {
        const head = node('div', 'crm-profile-heading');
        head.append(node('h3', '', c.name), button('Editar ficha', () => contactForm(c)));
        profile.append(head, node('p', 'crm-muted', `${c.relationship === 'client' ? 'Cliente' : 'Prospecto'} · ${c.status === 'active' ? 'Activo' : 'Archivado'} · ${c.phone || 'Sin teléfono'}`));
        const actions = node('div', 'crm-actions');
        if (c.status === 'active')
            actions.append(button('Nueva oportunidad', () => addLead(c.id)), button('Programar seguimiento', () => addFollowUp(c.id)), button('Registrar nota', () => addNote(c.id)));
        profile.append(actions);
        const telegram=node('section','crm-telegram-identities');profile.append(telegram);void telegramIdentityHistory(telegram,c.id);
        profile.append(node('h4', '', 'Emails de contacto'));
        for (const i of view.identities.filter(i => i.active)) {
            const row = node('div', 'crm-line');
            row.append(node('span', '', i.email + ' · sin verificar'), button('Retirar email', () => void mutate({ type: 'identity.remove', id: i.id })));
            profile.append(row);
        }
        if (c.status === 'active')
            profile.append(button('Añadir email', () => addIdentity(c.id)));
        profile.append(node('h4', '', 'Preparación y notas'), node('p', 'crm-notes', c.notes || 'Sin notas. Guarda las preguntas y documentos que debes pedir antes de llamar.'));
        profile.append(node('h4', '', 'Oportunidades'));
        for (const l of view.leads) {
            const row = node('div', 'crm-record');
            row.append(node('strong', '', l.title), node('span', 'crm-muted', lineLabels[l.line]!));
            const s = node('select', 'crm-state-select');
            s.setAttribute('aria-label', 'Estado de ' + l.title);
            for (const value of ['new', 'contacted', 'proposal', 'won', 'lost'] as const) {
                const o = node('option', '', statusLabels[value]);
                o.value = value;
                s.append(o);
            }
            s.value = l.status;
            s.disabled = c.status === 'archived';
            s.addEventListener('change', () => void mutate({ type: 'lead.update', id: l.id, status: s.value as typeof l.status }));
            row.append(s);
            profile.append(row);
        }
        if (!view.leads.length)
            profile.append(node('p', 'crm-muted', 'Sin oportunidades registradas.'));
        profile.append(node('h4', '', 'Próximos pasos'));
        for (const f of view.followUps) {
            const row = node('div', 'crm-record');
            row.append(node('strong', '', f.title), node('span', 'crm-muted', date(f.dueAt) + ' · ' + statusLabels[f.status]));
            if (f.status === 'pending')
                row.append(button('Marcar seguimiento como hecho', () => void mutate({ type: 'followup.update', id: f.id, status: 'done' })));
            profile.append(row);
        }
        if (!view.followUps.length)
            profile.append(node('p', 'crm-muted', 'Sin seguimientos programados.'));
        profile.append(node('h4', '', 'Historial de conversaciones'));
        if (view.interactions.length) profile.append(node('p', 'crm-muted', 'Últimos 100 registros. Las copias verificadas se muestran con su envío; el historial se conserva.'));
        for (const conversation of crmConversations(view.interactions)) {
            const card = node('section', 'crm-conversation');
            const heading = node('div', 'crm-conversation-heading');
            heading.append(node('strong', '', conversation.threaded ? 'Conversación Gmail' : 'Actividad registrada'), node('span', 'crm-muted', `${conversation.entries.length} ${conversation.entries.length === 1 ? 'actividad' : 'actividades'}`));
            card.append(heading);
            for (const entry of conversation.entries) {
                const i = entry.primary, delivery = i.trace?.delivery ?? (i.source.kind === 'gmail' ? 'gmail_imported' : i.source.kind === 'user' ? 'note' : 'unclassified');
                const row = node('article', 'crm-record');
                const display = crmInteractionDisplay(i);
                row.append(node('span', 'crm-delivery ' + delivery, crmDeliveryLabels[delivery]), node('strong', '', display.status), node('p', '', display.summary), node('small', 'crm-muted', date(i.updatedAt)));
                if (i.source.kind === 'effect') {
                    const taskId = i.source.taskId;
                    row.append(button('Ver trabajo', () => window.dispatchEvent(new CustomEvent('runtime:open-task', {detail: {taskId}}))));
                }
                const evidence = node('details', 'crm-record-evidence');
                evidence.append(node('summary', '', entry.records.length > 1 ? `${entry.records.length} registros · un único envío verificado` : 'Ver procedencia del registro'));
                for (const record of entry.records) {
                    const source = record.source;
                    evidence.append(node('p', 'crm-muted', `Registro ${record.id} · ${source.kind === 'effect' ? 'Efecto ' + source.effectId : source.kind === 'gmail' ? 'Correo Gmail ' + source.gmailId : 'Nota local'}`));
                }
                if (display.summary !== i.summary) evidence.append(node('p', 'crm-muted', 'Texto histórico original: ' + i.summary));
                if (i.trace?.observationId) evidence.append(node('p', 'crm-muted', 'Observación confirmada: ' + i.trace.observationId));
                if (i.trace?.mail) evidence.append(node('p', 'crm-muted', 'Conversación: ' + i.trace.mail.threadId + ' · cuenta ' + i.trace.mail.accountRef));
                row.append(evidence); card.append(row);
            }
            profile.append(card);
        }
        if (!view.interactions.length)
            profile.append(node('p', 'crm-muted', 'Sin interacciones registradas.'));
        for (const l of view.links) {
            profile.append(button('Desvincular correo ' + l.gmailId, () => void mutate({ type: 'mail.unlink', accountRef: l.accountRef, gmailId: l.gmailId })));
        }
        const history = node('details', 'crm-history');
        history.append(node('summary', '', 'Historial de cambios · últimos 50'));
        for (const a of view.audit)
            history.append(node('p', 'crm-muted', `${date(a.at)} · ${a.operation} · revisión ${a.revision}`));
        profile.append(history);
    }
    if (taskView) {
        byId('tasks-count').textContent = `${taskView.followUpsTotal} ${taskView.followUpsTotal===1?"seguimiento":"seguimientos"}${taskView.followUpsTruncated ? ' · mostrando los primeros 100' : ''} · ${taskView.counts.overdue} vencidos`;
        for (const f of taskView.followUps) {
            const row = node('article', 'task-row'), copy = node('div', '');
            const name = taskView.contacts.find(c => c.id === f.contactId)?.name ?? 'Contacto ' + f.contactId;
            copy.append(node('h3', '', f.title), node('p', '', name + ' · ' + date(f.dueAt)));
            row.append(node('span', 'priority ' + (f.status === 'pending' && f.dueAt < Date.now() ? 'urgent' : 'normal'), statusLabels[f.status]), copy, button('Ver cliente', () => { selected = f.contactId; query = ''; search.value = ''; kind.value = 'all'; location.hash = '#clients-screen'; void reload(); }));
            if (f.status === 'pending')
                row.append(button('Hecho', () => void mutate({ type: 'followup.update', id: f.id, status: 'done' })), button('Cancelar', () => void mutate({ type: 'followup.update', id: f.id, status: 'cancelled' })));
            tasks.append(row);
        }
        if (!taskView.followUps.length)
            empty(tasks, 'No hay seguimientos en esta vista', 'Programa tu próxima llamada o revisión desde la ficha del cliente.');
    }
}
async function telegramIdentityHistory(root:HTMLElement,contactId:string){
    const current=client,ticket=epoch;root.append(node('h4','','Identidades Telegram'),node('p','crm-muted','Consultando vinculaciones…'));if(!current)return;
    try{const v=await current.telegramContactIdentities(contactId);if(current!==client||ticket!==epoch||!root.isConnected||selected!==contactId)return;
        root.replaceChildren(node('h4','','Identidades Telegram'));
        for(const l of v.items){const row=node('div','crm-record');row.append(node('strong','',l.revokedAt===null?'Vinculación verificada por el profesional':'Vinculación retirada'),node('p','crm-muted',`Bot ${l.source.botId} · Chat ${l.source.chatId} · Remitente ${l.source.senderId}`),node('p','crm-muted',`${date(l.verifiedAt)} · ${l.actor}${l.revokedAt===null?'':` · Retirada ${date(l.revokedAt)} por ${l.revokedBy}`}`));root.append(row);}
        if(!v.items.length)root.append(node('p','crm-muted','Sin identidades de Telegram en las conversaciones autorizadas actuales.'));
        if(v.truncated)root.append(node('p','crm-muted',`Mostrando 100 de ${v.total} vinculaciones.`));
        root.append(button('Abrir Telegram',()=>{location.hash='#telegram-screen';}));
    }catch(e){if(current===client&&ticket===epoch&&root.isConnected)root.replaceChildren(node('h4','','Identidades Telegram'),node('p','crm-muted',e instanceof WorkspaceHttpError&&e.status===404?'Telegram no está habilitado en esta instalación.':'No se pudieron consultar las vinculaciones de Telegram. Actualiza para reintentar.'));}
}

async function reload() {
    const c = client;
    if (!c || busy)
        return;
    const seq = ++epoch, id = selected;
    try {
        const [v, t] = await Promise.all([c.crm({ query, contactId: id, taskStatus: 'all' }), c.crm({ taskStatus })]);
        if (c !== client || seq !== epoch)
            return;
        loadFailed = false;
        feedback('');
        view = v;
        taskView = t;
        render();
    }
    catch {
        if (c !== client || seq !== epoch)
            return;
        loadFailed = true;
        view = null;
        taskView = null;
        render();
        feedback('No se ha podido consultar el CRM. Comprueba el servicio local y actualiza.');
    }
}
async function openMail(accountRef: string, gmailId: string) {
    const c = client;
    if (!c || busy)
        return;
    const seq = ++epoch;
    try {
        const [r, v] = await Promise.all([c.crmResolve(accountRef, gmailId), c.crm()]);
        if (c !== client || seq !== epoch)
            return;
        view = v;
        const reasons: Record<CrmResolution['reason'], string> = { header_review_required: 'Las cabeceras están incompletas, son ambiguas o proceden de una importación anterior. Confirma el contacto manualmente.', exact_unique: 'Coincidencia exacta y única de email. Esto no verifica la identidad.', new_sender: 'Este email todavía no tiene un contacto. Revisa sus datos antes de crearlo.', ambiguous: 'Hay varios contactos con este email. Elige después de comprobarlo.', reply_to_mismatch: 'Reply-To difiere del remitente. Revisa quién debe asociarse a este correo.', invalid_address: 'La cabecera no contiene una única dirección válida. Revisión manual necesaria.' };
        showForm('Vincular correo al CRM', form => {
            form.append(node('p', '', r.address ?? 'Dirección pendiente de revisión'), node('p', 'crm-content-warning', reasons[r.reason]));
            if (r.link?.contactId) {
                form.append(node('p', '', 'Este correo ya tiene un contacto vinculado.'), button('Abrir cliente', () => { selected = r.link!.contactId; query = ''; search.value = ''; kind.value = 'all'; dialog.close(); location.hash = '#clients-screen'; void reload(); }));
                return;
            }
            if (r.reason !== 'exact_unique' && r.reason !== 'ambiguous')
                form.append(button('Crear contacto', () => { dialog.close(); contactForm(null, { email: r.address ?? '' }, () => openMail(accountRef, gmailId)); }));
            const candidates = v.contacts.filter(c => c.status === 'active'), options: [
                string,
                string
            ][] = [['', 'Selecciona un contacto'], ...candidates.map(c => [c.id, c.name] as [
                    string,
                    string
                ])];
            const pick = selectField(form, 'contact', 'Contacto', options, r.candidates.length === 1 ? r.candidates[0]!.id : '');
            const reviewed = node('label', 'crm-check'), check = node('input', '');
            const contactSearch = field(form, 'contact-search', 'Buscar contacto para vincular', '', 'search', false, 100);
            let lookupEpoch = 0;
            contactSearch.addEventListener('input', async () => { const seq = ++lookupEpoch; pick.replaceChildren(); const placeholder = node('option', '', 'Buscando contactos…'); placeholder.value = ''; pick.append(placeholder); check.checked = false; try {
                const matches = await c.crm({ query: contactSearch.value });
                if (seq !== lookupEpoch || c !== client || !form.isConnected)
                    return;
                pick.replaceChildren();
                const emptyOption = node('option', '', 'Selecciona un contacto');
                emptyOption.value = '';
                pick.append(emptyOption);
                for (const contact of matches.contacts.filter(v => v.status === 'active')) {
                    const option = node('option', '', contact.name);
                    option.value = contact.id;
                    pick.append(option);
                }
            }
            catch {
                if (seq === lookupEpoch && c === client && form.isConnected)
                    dialogFeedback.textContent = 'No se ha podido buscar. Inténtalo de nuevo.';
            } });
            check.type = 'checkbox';
            reviewed.append(check, document.createTextNode('He revisado la relación de este correo con el contacto.'));
            form.append(reviewed);
            const save = submitButton(form, 'Vincular correo'), commandId = crypto.randomUUID();
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (busy || c !== client) return;
                if (!pick.value || !check.checked) {
                    dialogFeedback.textContent = 'Selecciona el contacto y confirma la revisión.';
                    return;
                }
                save.disabled = true;
                busy = true;
                try {
                    const result = await c.crmLink({ accountRef, gmailId, commandId, expectedRevision: r.revision, contactId: r.reason === 'exact_unique' && pick.value === r.candidates[0]!.id ? null : pick.value, reviewed: true });
                    if (c !== client)
                        return;
                    selected = result.contactId;
                    query = '';
                    search.value = '';
                    kind.value = 'all';
                    dialog.close();
                    location.hash = '#clients-screen';
                    feedback('Correo vinculado. La interacción está guardada en el historial.');
                    window.dispatchEvent(new Event('crm-changed'));
                }
                catch {
                    if (c === client)
                        dialogFeedback.textContent = 'No se ha confirmado el vínculo. Si el CRM cambió, cierra y revisa de nuevo.';
                }
                finally {
                    if (c === client) {
                        busy = false;
                        save.disabled = false;
                        void reload();
                    }
                }
            });
        });
    }
    catch {
        if (c === client) {
            feedback('No se puede usar este correo: su cuenta o contenido pudo cambiar. Actualiza Gmail y vuelve a intentarlo.');
            location.hash = '#clients-screen';
        }
    }
}
export function setCrmClient(value: WorkspaceClient | null) {
    loadFailed = false;
    epoch++;
    client = value;
    view = null;
    taskView = null;
    selected = null;
    query = '';
    search.value = '';
    busy = false;
    pending.clear();
    if (searchTimer)
        clearTimeout(searchTimer);
    if (dialog.open)
        dialog.close();
    render();
    if (value)
        void reload();
}
byId('crm-new-contact').addEventListener('click', () => contactForm(null));
byId('crm-refresh').addEventListener('click', () => void reload());
byId('crm-tasks-refresh').addEventListener('click', () => void reload());
byId('crm-dialog-close').addEventListener('click', () => dialog.close());
search.addEventListener('input', () => {
    epoch++;
    selected = null;
    query = search.value.slice(0, 100);
    empty(profile, 'Selecciona un contacto', 'Buscando…');
    list.replaceChildren(node('p','crm-muted','Buscando contactos…'));
    if (searchTimer)
        clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void reload(), 250);
});
kind.addEventListener('change', render);
byId<HTMLSelectElement>('crm-task-status').addEventListener('change', e => { taskStatus = (e.target as HTMLSelectElement).value as typeof taskStatus; void reload(); });
window.addEventListener('hashchange', () => {
    if (['#clients-screen', '#tasks-screen'].includes(location.hash))
        void reload();
});
window.addEventListener('crm:open-mail', e => {
    const d = (e as CustomEvent).detail;
    if (d && typeof d.accountRef === 'string' && typeof d.gmailId === 'string')
        void openMail(d.accountRef, d.gmailId);
});
window.addEventListener('crm:open-contact',e=>{const d=(e as CustomEvent).detail;if(!client||busy||!d||typeof d.contactId!=='string')return;selected=d.contactId;query='';search.value='';kind.value='all';location.hash='#clients-screen';void reload();});
setCrmClient(null);
