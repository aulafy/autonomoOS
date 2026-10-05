import {WorkspaceHttpError,type WorkspaceClient} from './workspace-client.js';
import type {ReviewFilter,ReviewPage,ReviewRow,ReviewState} from './review-contract.js';
import './review-screen.css';
const root=document.getElementById('review-queue')!;
const demo=document.createElement('div');while(root.firstChild)demo.append(root.firstChild);root.append(demo);root.dataset.reviewMode='demo';
const live=document.createElement('div');live.className='review-live';live.hidden=true;
// Static shell only. All server data is rendered through textContent below.
live.innerHTML=`<a class="workflow-back" href="#home-screen">← Mi jornada</a><div class="panel-heading"><div><span class="eyebrow">CONTROL DE RESPUESTAS</span><h2>Revisión</h2><p>Decide qué preparar, corregir o comprobar.</p></div><button type="button" id="review-refresh" class="secondary">Actualizar</button></div><div id="review-metrics" class="review-metrics" aria-label="Estado de los trabajos"></div><div class="review-toolbar"><label class="review-search">Buscar trabajo o cliente<input type="search" id="review-search" maxlength="100" placeholder="Nombre, asunto o consulta…"></label><label>Estado<select id="review-filter" aria-label="Estado"></select></label></div><p class="review-explanation">Última versión de cada trabajo. Los estados reflejan el registro local; al abrir se comprueban la cuenta, el contenido y los permisos. Ningún correo se envía desde esta lista.</p><p id="review-feedback" role="status"></p><div id="review-live-list" class="review-live-list"></div><footer class="review-footer"><span id="review-page-summary"></span><button type="button" id="review-more" class="secondary" hidden>Mostrar más</button></footer>`;
root.append(live);
const labels:Record<ReviewState,string>={draft:'Por preparar',approval:'Por aprobar',ready:'Aprobado · sin enviar',rejected:'Rechazado',blocked:'Bloqueado',uncertain:'Envío incierto',running:'En curso',failed:'Requiere atención',completed:'Completado',cancelled:'Cancelado'};
const filterLabels:Record<ReviewFilter,string>={attention:'Pendientes y atención',all:'Todos los trabajos',...labels};
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const search=get<HTMLInputElement>('review-search'),filter=get<HTMLSelectElement>('review-filter'),refresh=get<HTMLButtonElement>('review-refresh'),more=get<HTMLButtonElement>('review-more'),list=get('review-live-list'),metrics=get('review-metrics'),feedback=get('review-feedback'),summary=get('review-page-summary');
for(const [value,label] of Object.entries(filterLabels)){const o=document.createElement('option');o.value=value;o.textContent=label;filter.append(o);}
let client:WorkspaceClient|null=null,epoch=0,loading=false,page:ReviewPage|null=null,rows:ReviewRow[]=[],cursor:string|null=null;
let searchTimer:ReturnType<typeof setTimeout>|null=null;
function el<K extends keyof HTMLElementTagNameMap>(tag:K,cls:string,text?:string){const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function controls(){refresh.disabled=!client||loading;more.disabled=loading||!client;more.hidden=!cursor;search.disabled=!client;filter.disabled=!client;root.setAttribute('aria-busy',String(loading));}
function empty(title:string,note:string){const n=el('div','review-empty');n.append(el('span','review-empty-icon','✓'),el('h3','',title),el('p','',note));list.replaceChildren(n);}
function choose(value:ReviewFilter){filter.value=value;void load(false);}
function render(){
 metrics.replaceChildren();
 for(const [title,count,value] of [['Por aprobar',page?.counts.approval??0,'approval'],['Por preparar',page?.counts.draft??0,'draft'],['Envíos inciertos',page?.counts.uncertain??0,'uncertain'],['Completados',page?.counts.completed??0,'completed']] as const){const b=el('button','review-metric'+(value==='uncertain'?' is-uncertain':''));b.type='button';b.disabled=!client||loading;b.append(el('strong','',page?String(count):'—'),el('span','',title));b.addEventListener('click',()=>choose(value));metrics.append(b);}
 list.replaceChildren();
 for(const row of rows){
  const n=el('article','review-live-row'),identity=el('div','review-row-identity'),copy=el('div','review-row-copy');
  const initial=(row.contactName??'Correo').charAt(0).toLocaleUpperCase('es');identity.append(el('span','review-avatar',initial));
  copy.append(el('h3','',row.contactName??row.title));if(row.contactName)copy.append(el('p','',row.title));
  const metadata=[row.origin==='gmail'?'Respuesta a correo':'Trabajo registrado',row.delivery==='gmail'?'Gmail real':row.delivery==='test'?'Envío simulado':'Envío sin configurar',`Versión ${row.revision}`];
  if(row.priority!=='normal')metadata.push(row.priority==='urgent'?'Urgente':'Prioridad alta');copy.append(el('small','',metadata.join(' · ')));identity.append(copy);n.append(identity);
  const state=el('div','review-row-state');const badge=el('span','review-state',row.status==='draft'&&row.origin==='gmail'?'Borrador':labels[row.status]);badge.dataset.state=row.status;state.append(badge,el('time','',new Date(row.updatedAt).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})));n.append(state);
  const button=el('button','review-open',row.status==='uncertain'?'Comprobar envío →':row.status==='completed'?'Ver resultado →':'Abrir revisión →');button.type='button';button.disabled=loading;button.setAttribute('aria-label',`Abrir ${row.title}`);
  const captured=epoch;button.onclick=()=>{if(!client||loading||captured!==epoch||!rows.some(r=>r.taskId===row.taskId))return;window.dispatchEvent(new CustomEvent('runtime:open-task',{detail:{taskId:row.taskId}}));};n.append(button);list.append(n);
 }
 if(!rows.length)empty(loading?'Consultando trabajos…':page?'Sin trabajos en esta vista':'Conecta tu espacio de trabajo',loading?'Estamos leyendo los trabajos guardados en este Mac.':page?'Prueba otro estado o prepara una respuesta desde Correo Gmail.':'Los trabajos reales aparecerán al conectar el runtime en Configuración.');
 summary.textContent=page?`${rows.length} de ${page.matchedTotal} en esta vista · ${page.total} trabajos actuales`:'Sin datos cargados';controls();
}
async function load(append=false){
 const c=client;if(!c)return;const generation=++epoch,previous=page,next=append?cursor:null;
 loading=true;if(!append){rows=[];cursor=null;page=null;}feedback.textContent='';render();
 try{
  const result=await c.reviewQueue({filter:filter.value as ReviewFilter,query:search.value.trim(),limit:25,cursor:next});
  if(c!==client||generation!==epoch)return;
  if(append&&previous?.snapshotHash!==result.snapshotHash)throw new Error('REVIEW_CHANGED');
  rows=append?[...rows,...result.items]:result.items;page=result;cursor=result.nextCursor;loading=false;render();
 }catch(error){
  if(c!==client||generation!==epoch)return;loading=false;rows=[];cursor=null;page=null;render();
  if(append&&error instanceof WorkspaceHttpError&&error.status===409){await load(false);if(c===client)feedback.textContent='Los trabajos cambiaron. La lista se ha actualizado desde el principio.';return;}
  feedback.textContent=error instanceof WorkspaceHttpError&&error.status===401?'Tu sesión ha caducado. Conecta de nuevo en Configuración.':'No se ha podido confirmar la lista. Pulsa Actualizar para reintentar.';
  empty('Revisión no disponible','La lista no se sustituye por datos de demostración.');
 }
}
refresh.onclick=()=>void load(false);more.onclick=()=>{if(cursor&&!loading)void load(true);};filter.onchange=()=>void load(false);
search.oninput=()=>{epoch++;loading=true;rows=[];page=null;cursor=null;render();if(searchTimer)clearTimeout(searchTimer);searchTimer=setTimeout(()=>void load(false),250);};
function reset(){epoch++;if(searchTimer)clearTimeout(searchTimer);searchTimer=null;loading=false;page=null;rows=[];cursor=null;search.value='';filter.value='attention';}
export function setReviewClient(value:WorkspaceClient|null){reset();client=value;demo.hidden=!!value;live.hidden=!value;root.dataset.reviewMode=value?'live':'demo';if(value)void load(false);}
export function setReviewUnavailable(){reset();client=null;demo.hidden=true;live.hidden=false;root.dataset.reviewMode='unavailable';render();feedback.textContent='Conecta tu espacio de trabajo en Configuración para consultar la revisión real.';}
window.addEventListener('hashchange',()=>{if(location.hash==='#review-queue'&&client)void load(false);});

if(new URLSearchParams(location.search).has('workspaceApi')||new URLSearchParams(location.search).has('tenant'))setReviewUnavailable();
