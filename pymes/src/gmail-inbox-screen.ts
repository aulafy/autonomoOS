import {mountMailAssistance} from './mail-assistance-screen.js';
import type { WorkspaceClient } from './workspace-client.js';
import { WorkspaceHttpError } from './workspace-client.js';
import type { InboxStatusView } from './inbox-service.js';
import type { MessageSummary } from './inbox-store.js';
import { acceptInboxDetail, inboxDate, inboxStateLabel, reconcileInboxSelection, sameInboxContext, type InboxContextTag, type PurgeChallenge } from './gmail-inbox-view.js';
import './gmail-inbox-screen.css';
const root = document.getElementById('gmail-inbox');
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const list = byId<HTMLElement>('gmail-message-list'), detail = byId<HTMLElement>('gmail-message-detail');
const sync = byId<HTMLButtonElement>('gmail-sync'), purge = byId<HTMLButtonElement>('gmail-purge');
const refresh = byId<HTMLButtonElement>('gmail-refresh'), more = byId<HTMLButtonElement>('gmail-more');
const account = byId<HTMLSelectElement>('gmail-account'), search = byId<HTMLInputElement>('gmail-search');
const dialog = byId<HTMLDialogElement>('gmail-purge-dialog'), phrase = byId<HTMLInputElement>('gmail-purge-phrase');
const confirm = byId<HTMLButtonElement>('gmail-purge-confirm');
let client: WorkspaceClient | null = null, epoch = 0, detailEpoch = 0, requestedAccount: string | undefined;
let status: InboxStatusView | null = null, context: InboxContextTag | null = null, items: MessageSummary[] = [], selected: string | null = null, cursor: string | null = null;
let scope: 'inbox' | 'sent' | 'archived' = 'inbox', query = '', loading = false, operating = false, challenge: PurgeChallenge | null = null;
let timer: ReturnType<typeof setTimeout> | null = null, searchTimer: ReturnType<typeof setTimeout> | null = null;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] { const n = document.createElement(tag); n.className = cls; if (text !== undefined)
    n.textContent = text; return n; }
function feedback(text: string, error = false) { const n = byId('gmail-feedback'); n.textContent = text; n.classList.toggle('is-error', error); }
function emptyDetail(text = 'Selecciona un correo para ver su contenido.') { detail.replaceChildren(el('div', 'gmail-detail-empty', text)); detail.removeAttribute('aria-busy'); }
function emptyList(title: string, note: string) { const block = el('div', 'gmail-empty'); block.append(el('span', 'gmail-empty-symbol', '✉'), el('h3', '', title), el('p', '', note)); list.replaceChildren(block); }
function readable(): boolean { return !!status?.account && (!status.connected || status.account.active); }
function controls() { sync.disabled = !client || !status?.connected || status.state === 'needs_reconnect' || !!status?.running || operating || loading; refresh.disabled = !client || operating || loading; purge.disabled = !client || !status?.account || !!status.running || operating || loading; account.disabled = !client || operating; search.disabled = !client || !readable() || operating; more.disabled = loading || operating; more.hidden = !cursor; root?.setAttribute('aria-busy', String(loading)); }
function renderStatus() {
    const target = byId('gmail-sync-status'), note = byId('gmail-sync-note'), summary = byId('gmail-page-summary');
    target.textContent = status ? inboxStateLabel(status) : client ? 'Consultando la cuenta…' : 'Conecta tu espacio de trabajo para ver el correo.';
    target.dataset.state = status?.state ?? 'never';
    const window = status ? `Selección inicial: ${status.window.days} días · hasta ${status.window.cap.toLocaleString('es-ES')} correos.` : '';
    note.textContent = status ? `${window} ${status.truncated ? 'La importación inicial está recortada. ' : ''}${status.catchupPending ? 'Falta aplicar cambios del historial. ' : ''}${status.autoSyncPaused ? 'Pulsa «Sincronizar ahora» para volver a importar.' : status.connected ? 'Consulta automática cada 5 minutos.' : 'Datos locales conservados; no se actualizan.'}` : 'Gmail se consulta en modo lectura. Los correos no se envían ni se modifican desde esta pantalla.';
    summary.textContent = status?.account ? `${items.length.toLocaleString('es-ES')} visibles · ${status.messageCount.toLocaleString('es-ES')} guardados en esta cuenta` : 'Sin mensajes importados';
    account.replaceChildren();
    if (status?.accounts.length) {
        for (const a of status.accounts) {
            const option = el('option', '', a.email + (a.active ? ' · conectada' : ' · guardada'));
            option.value = a.accountRef;
            account.append(option);
        }
        if (status.account)
            account.value = status.account.accountRef;
    }
    else {
        const option = el('option', '', status?.connected ? 'Cuenta conectada · importación pendiente' : 'Sin cuenta importada');
        option.value = '';
        account.append(option);
    }
    byId('gmail-connection-link').hidden = !!status?.connected && status.state !== 'needs_reconnect';
    controls();
}
function renderList() {
    list.replaceChildren();
    if (!items.length) {
        emptyList(!client ? 'Conecta tu oficina' : !readable() && status?.connected ? 'Cuenta anterior' : query ? 'No hay coincidencias' : 'No hay correos en esta vista', !client ? 'Entra en Configuración y conecta tu espacio de trabajo.' : !readable() && status?.connected ? 'El contenido de esta cuenta se oculta mientras otra está conectada. Puedes borrar sus datos locales.' : query ? 'Prueba con otro nombre, asunto o vista previa.' : 'Los nuevos mensajes aparecerán después de la sincronización.');
        return;
    }
    for (const item of items) {
        const row = el('button', 'gmail-message' + (selected === item.gmailId ? ' selected' : ''));
        row.type = 'button';
        row.dataset.gmailId = item.gmailId;
        row.setAttribute('aria-pressed', String(selected === item.gmailId));
        const sender = item.from || 'Remitente no disponible', avatar = el('span', 'gmail-avatar', sender.replace(/^["\s]+/, '').slice(0, 1).toLocaleUpperCase('es'));
        const content = el('span', 'gmail-row-content'), head = el('span', 'gmail-row-head');
        head.append(el('strong', 'gmail-sender', sender), el('time', 'gmail-row-date', inboxDate(item.internalDate)));
        content.append(head, el('span', 'gmail-subject', item.subject || 'Sin asunto'), el('span', 'gmail-preview', item.snippet || 'Sin vista previa'));
        const badges = el('span', 'gmail-row-badges');
        if (item.labels.includes('UNREAD'))
            badges.append(el('span', 'gmail-unread', 'Sin leer'));
        if (item.attachmentCount)
            badges.append(el('span', '', `${item.attachmentCount} adjunto${item.attachmentCount === 1 ? '' : 's'}`));
        content.append(badges);
        row.append(avatar, content);
        row.addEventListener('click', () => { if (loading || operating)
            return; selected = item.gmailId; renderList(); void loadDetail(); });
        list.append(row);
    }
}
async function loadDetail() {
    const c = client, binding = context, id = selected, seq = ++detailEpoch, requestEpoch = epoch;
    if (!c || !binding?.accountRef || !id || !readable()) {
        emptyDetail();
        return;
    }
    emptyDetail('Cargando correo…');
    detail.setAttribute('aria-busy', 'true');
    try {
        const response = await c.gmailInboxMessage(id, binding.accountRef);
        if (c !== client || seq !== detailEpoch || requestEpoch !== epoch)
            return;
        if (!context || !acceptInboxDetail(context, response, items, selected)) {
            selected = null;
            renderList();
            emptyDetail('El correo cambió. Actualiza la lista para consultarlo.');
            return;
        }
        const m = response.message;
        detail.replaceChildren();
        const top = el('div', 'gmail-detail-heading');
        top.append(el('span', 'gmail-detail-label', scope === 'sent' ? 'CORREO ENVIADO' : m.scopeState === 'archived' ? 'CORREO ARCHIVADO' : 'CORREO RECIBIDO'), el('h3', '', m.subject || 'Sin asunto'));
        const meta = el('dl', 'gmail-envelope');
        for (const [label, value] of [['De', m.from], ['Para', m.to], ['CC', m.cc], ['Fecha', inboxDate(m.internalDate, true)], ['Responder a', m.replyTo]]) {
            if (value)
                meta.append(el('dt', '', label!), el('dd', '', value));
        }
        const notices: string[] = [];
        if (m.bodyTruncated)
            notices.push('Contenido recortado al límite local.');
        if (m.bodySource === 'too_large')
            notices.push('Correo demasiado grande: solo se han importado sus cabeceras.');
        if (m.quality?.bodyUnavailable)
            notices.push('Parte del cuerpo no está disponible en esta importación.');
        if (m.quality?.charsetFallback)
            notices.push('Se ha usado una codificación alternativa; revisa los caracteres.');
        if (m.quality?.structureTruncated)
            notices.push('La estructura del correo supera el límite de partes.');
        if (m.quality?.attachmentsTruncated)
            notices.push('La lista de adjuntos está recortada.');
        if (m.quality === null)
            notices.push('Este registro anterior no tiene información de calidad.');
        detail.append(top, meta);
        if (notices.length)
            detail.append(el('p', 'gmail-content-notice', notices.join(' ')));
        detail.append(el('pre', 'gmail-body', m.bodyText || 'No se ha importado texto del cuerpo de este correo.'));
        if (m.attachments.length) {
            const files = el('section', 'gmail-attachments');
            files.append(el('h4', '', `Adjuntos · ${m.attachments.length}`), el('p', '', 'Solo metadatos. Los archivos no se descargan desde Gmail.'));
            for (const file of m.attachments) {
                const row = el('div', 'gmail-file');
                row.append(el('strong', '', file.filename || 'Archivo sin nombre'), el('span', '', `${file.mimeType} · ${Math.ceil(file.size / 1024).toLocaleString('es-ES')} KB`));
                files.append(row);
            }
            detail.append(files);
        }
        const crmButton=el('button','gmail-button','Ver / vincular contacto');crmButton.type='button';crmButton.addEventListener('click',()=>{if(c!==client||!context||!acceptInboxDetail(context,response,items,selected))return;window.dispatchEvent(new CustomEvent('crm:open-mail',{detail:{accountRef:context.accountRef,gmailId:m.gmailId}}));});detail.append(crmButton);
        if(context?.accountRef)mountMailAssistance(detail,c,context.accountRef,m.gmailId,()=>c===client&&seq===detailEpoch&&requestEpoch===epoch&&selected===m.gmailId&&items.some(i=>i.gmailId===selected),{subject:m.subject??'',incoming:!m.labels.includes('SENT')});
        detail.append(el('p', 'gmail-readonly-note', 'Vista de lectura · Este mensaje no activa tareas ni concede permisos al asistente.'));
    }
    catch (error) {
        if (c !== client || seq !== detailEpoch || requestEpoch !== epoch)
            return;
        emptyDetail(error instanceof WorkspaceHttpError && error.status === 404 ? 'Este correo ya no está disponible. Actualiza la lista.' : 'No se ha podido consultar el correo. Actualiza la lista.');
        selected = null;
        renderList();
    }
    finally {
        if (seq === detailEpoch)
            detail.removeAttribute('aria-busy');
    }
}
function schedule(ms: number) { if (timer)
    clearTimeout(timer); timer = setTimeout(() => { timer = null; if (location.hash === '#gmail-inbox' && client && !operating) {
    if(detail.querySelector('[data-mail-ai-busy="true"]'))schedule(2000);
    else void reload();
    } }, ms); }
async function reload(append = false) {
    const c = client;
    if (!c || operating)
        return;
    if (timer)
        clearTimeout(timer);
    timer = null;
    const seq = ++epoch, oldContext = context, oldSelected = selected;
    detailEpoch++;
    emptyDetail();
    loading = true;
    controls();
    feedback('');
    try {
        const view = await c.gmailInbox(requestedAccount);
        if (c !== client || seq !== epoch)
            return;
        status = view;
        if (!view.account || view.connected && !view.account.active) {
            items = [];
            context = view.context;
            cursor = null;
            selected = null;
            renderList();
            renderStatus();
            return;
        }
        const page = await c.gmailInboxMessages({ scope, query, cursor: append ? cursor : null, accountRef: view.account.accountRef });
        if (c !== client || seq !== epoch)
            return;
        if (!sameInboxContext(view.context, page.context)) {
            items = [];
            context = null;
            cursor = null;
            selected = null;
            renderList();
            feedback('La cuenta se está actualizando. Consultando de nuevo…');
            schedule(1500);
            return;
        }
        if (append && oldContext && !sameInboxContext(oldContext, page.context)) {
            items = [];
            cursor = null;
            selected = null;
            feedback('El correo cambió. La lista se ha actualizado.');
            schedule(1000);
            return;
        }
        items = append ? [...new Map([...items, ...page.items].map(m => [m.gmailId, m])).values()] : page.items;
        context = page.context;
        cursor = page.nextCursor;
        const sameAccount = oldContext?.tag === context.tag && oldContext.accountRef === context.accountRef;
        selected = reconcileInboxSelection(items, sameAccount ? oldSelected : null, true);
        renderList();
        renderStatus();
        if (selected)
            void loadDetail();
    }
    catch (error) {
        if (c !== client || seq !== epoch)
            return;
        items = [];
        selected = null;
        context = null;
        cursor = null;
        emptyDetail();
        const absent = error instanceof WorkspaceHttpError && error.status === 404;
        emptyList(absent ? 'Correo Gmail no disponible' : 'No se ha podido actualizar', absent ? 'El servicio de Gmail todavía no está habilitado en esta instalación.' : 'Comprueba la conexión con el servicio del Mac y vuelve a intentarlo.');
        feedback(error instanceof WorkspaceHttpError && error.status === 409 ? 'El estado de la cuenta cambió. Reintentando…' : absent ? 'Configura Gmail y su servicio local en Configuración.' : 'Los datos anteriores se han ocultado para evitar mostrar una cuenta o selección desactualizada.', !absent);
    }
    finally {
        if (c === client && seq === epoch) {
            loading = false;
            renderStatus();
            controls();
            if (!timer)
                schedule(status?.running || status?.catchupPending ? 2000 : 30000);
        }
    }
}
async function syncNow() { const c = client; if (!c || operating)
    return; operating = true; epoch++; detailEpoch++; emptyDetail(); controls(); feedback(status?.autoSyncPaused ? 'Volviendo a importar los correos de Gmail…' : 'Iniciando sincronización…'); try {
    const view = await c.gmailInboxSync();
    if (c !== client)
        return;
    status = view;
    requestedAccount = undefined;
}
catch {
    if (c === client)
        feedback('No se ha confirmado el inicio. Actualiza el estado antes de reintentar.', true);
}
finally {
    if (c === client) {
        operating = false;
        controls();
        void reload();
    }
} }
async function preparePurge() { const c = client, ref = status?.account?.accountRef; if (!c || !ref || operating)
    return; operating = true; controls(); try {
    const value = await c.gmailInboxPreparePurge(ref);
    if (c !== client)
        return;
    challenge = value;
    phrase.value = '';
    confirm.disabled = true;
    byId('gmail-purge-description').textContent = `Se borrarán ${value.messageCount.toLocaleString('es-ES')} correos guardados de ${value.account}. Gmail conservará sus mensajes. La consulta automática quedará pausada hasta que pulses «Sincronizar ahora».`;
    byId('gmail-purge-error').textContent = '';
    dialog.showModal();
    phrase.focus();
}
catch {
    if (c === client)
        feedback('No se ha podido preparar el borrado. Actualiza la cuenta y vuelve a intentarlo.', true);
}
finally {
    if (c === client) {
        operating = false;
        controls();
    }
} }
async function commitPurge(event: SubmitEvent) { event.preventDefault(); const c = client, value = challenge; if (!c || !value || phrase.value !== 'BORRAR' || Date.now() >= value.expiresAt)
    return; operating = true; epoch++; detailEpoch++; confirm.disabled = true; phrase.disabled = true; controls(); try {
    await c.gmailInboxPurge(value, phrase.value);
    if (c !== client)
        return;
    dialog.close();
    items = [];
    context = null;
    selected = null;
    cursor = null;
    emptyDetail();
    renderList();
    feedback('Datos locales borrados. La sincronización automática está pausada.');
}
catch {
    if (c !== client)
        return;
    byId('gmail-purge-error').textContent = 'El borrado no se ha confirmado. La cuenta pudo cambiar o estar ocupada. Cierra este diálogo y confirma de nuevo.';
    challenge = null;
}
finally {
    phrase.disabled = false;
    if (c === client) {
        operating = false;
        controls();
        void reload();
    }
} }
export function setGmailInboxClient(value: WorkspaceClient | null) { epoch++; detailEpoch++; client = value; status = null; context = null; items = []; selected = null; cursor = null; requestedAccount = undefined; loading = false; operating = false; challenge = null; if (timer)
    clearTimeout(timer); if (searchTimer)
    clearTimeout(searchTimer); timer = null; searchTimer = null; if (dialog?.open)
    dialog.close(); emptyDetail(); renderList(); renderStatus(); if (value)
    void reload(); }
if (root) {
    sync.addEventListener('click', () => void syncNow());
    refresh.addEventListener('click', () => void reload());
    more.addEventListener('click', () => void reload(true));
    purge.addEventListener('click', () => void preparePurge());
    account.addEventListener('change', () => { requestedAccount = account.value || undefined; items = []; context = null; selected = null; cursor = null; emptyDetail(); renderList(); void reload(); });
    search.addEventListener('input', () => { epoch++; detailEpoch++; selected = null; context = null; items = []; cursor = null; emptyDetail(); renderList(); query = search.value.slice(0, 100); if (searchTimer)
        clearTimeout(searchTimer); searchTimer = setTimeout(() => void reload(), 300); });
    root.querySelectorAll<HTMLButtonElement>('[data-gmail-scope]').forEach(button => button.addEventListener('click', () => { scope = button.dataset.gmailScope as typeof scope; items = []; selected = null; context = null; cursor = null; emptyDetail(); renderList(); root.querySelectorAll('[data-gmail-scope]').forEach(n => n.setAttribute('aria-pressed', String(n === button))); void reload(); }));
    byId('gmail-purge-form').addEventListener('submit', event => void commitPurge(event as SubmitEvent));
    byId('gmail-purge-cancel').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { challenge = null; phrase.value = ''; });
    phrase.addEventListener('input', () => { confirm.disabled = operating || phrase.value !== 'BORRAR' || !challenge || Date.now() >= challenge.expiresAt; });
    window.addEventListener('hashchange', () => { if (location.hash === '#gmail-inbox')
        void reload();
    else {
        if (timer)
            clearTimeout(timer);
        timer = null;
    } });
    window.addEventListener('gmail-connection-changed', () => { epoch++; detailEpoch++; selected = null; context = null; items = []; emptyDetail(); renderList(); void reload(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) {
        if (timer)
            clearTimeout(timer);
        timer = null;
    }
    else if (location.hash === '#gmail-inbox')
        void reload(); });
    setGmailInboxClient(null);
}
