import type {WorkspaceClient} from './workspace-client.js';
import type {SavedMailProposal} from './mail-assistance-contract.js';
import './mail-assistance-screen.css';
import {mountMailTaskEditor} from './mail-task-screen.js';
const topic:Record<string,string>={incident:'Incidencia / siniestro',quote:'Propuesta de seguro',renewal:'Renovación',appointment:'Cita',service:'Gestión de póliza',unknown:'Por determinar'};
const line:Record<string,string>={car:'Coche',life:'Vida',home:'Hogar',professional_liability:'RC profesional',unknown:'Sin ramo confirmado'};
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text:string,cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
/** All model content is text; only a visible, authorized source can offer actions. */
export function mountMailAssistance(parent:HTMLElement,client:WorkspaceClient,accountRef:string,gmailId:string,authorized:()=>boolean,source?:{subject:string;incoming:boolean}){
 const card=node('section','','mail-ai-card');card.setAttribute('aria-label','Asistente local del correo');parent.append(card);
 let value:SavedMailProposal|null=null,busy=false,sequence=0;
 const current=()=>card.isConnected&&authorized();
 const button=(title:string,action:()=>void)=>{const b=node('button',title,'gmail-button');b.type='button';b.disabled=busy;b.onclick=()=>{if(current()&&!busy)action();};return b;};
 function render(note=''){
  card.dataset.mailAiBusy=String(busy);
  card.replaceChildren(node('span','ASISTENTE LOCAL','eyebrow'),node('h4','Resumen y preparación'),node('p','Se analiza el texto de este correo en este Mac. La propuesta necesita tu revisión; aceptar no envía ni cambia el CRM.','mail-ai-note'));
  const status=node('p',note,'mail-ai-status');status.setAttribute('role','status');card.append(status);
  if(!value){card.append(button(busy?'Preparando…':'Preparar con IA local',()=>void request('generate')));return;}
  const p=value.proposal;
  card.append(node('p',`${topic[p.topic]} · ${line[p.line]} · ${p.priority==='urgent'?'Urgente':p.priority==='high'?'Prioridad alta':'Prioridad normal'}`,'mail-ai-tags'),node('p',p.summary,'mail-ai-summary'),node('p',p.reason,'mail-ai-note'));
  if(value.inputTruncated)card.append(node('p','Análisis de un fragmento: el cuerpo es largo o el parser no pudo recuperar todo el contenido. Revisa el correo original.','mail-ai-warning'));
  card.append(node('h5','Fragmentos que respaldan la propuesta'));for(const quote of p.evidenceQuotes)card.append(node('blockquote',quote));
  if(p.missingInformation.length){card.append(node('h5','Información pendiente'));const list=node('ul','');for(const question of p.missingInformation)list.append(node('li',question));card.append(list);}
  card.append(node('h5','Borrador para revisar'),node('strong',p.draft.subject),node('pre',p.draft.body,'mail-ai-draft'));
  card.append(node('p',`Modelo ${value.model} · ${new Date(value.createdAt).toLocaleString('es-ES')} · ${value.state==='accepted'?'Aceptado por el profesional':value.state==='rejected'?'Descartado por el profesional':'Pendiente de revisión'}`,'mail-ai-note'));
  if(value.state==='proposed'){const actions=node('div','','mail-ai-actions');actions.append(button('Aceptar propuesta',()=>void request('review','accepted')),button('Descartar propuesta',()=>void request('review','rejected')));card.append(actions);}
  if(value.state==='rejected')card.append(button('Preparar otra propuesta',()=>void request('generate')));
  if(value.state==='accepted')card.append(node('p','Propuesta guardada. El envío requiere preparar un trabajo y aprobar su destinatario y contenido exactos en el Centro de agentes.','mail-ai-note'));
  if(value.state==='accepted'&&source?.incoming)card.append(button('Preparar trabajo de respuesta',()=>{if(!card.querySelector('.mail-task-editor'))void mountMailTaskEditor(card,client,accountRef,gmailId,value!,source.subject,current);}));
 }
 async function request(operation?:'generate'|'review',decision?:'accepted'|'rejected'){
  if(!current()||busy)return;busy=true;const seq=++sequence;render(operation==='generate'?'El modelo está preparando la propuesta…':operation==='review'?'Guardando tu revisión…':'Consultando la propuesta guardada…');
  try{const response=await client.mailAssistance(accountRef,gmailId,operation,decision&&value?{proposalId:value.id,decision}:undefined);if(!current()||seq!==sequence)return;value=response.proposal;busy=false;render(operation==='review'?'Revisión guardada.':operation==='generate'?'Propuesta preparada. Comprueba el resumen y el borrador antes de aceptarlos.':'');}
  catch{if(!current()||seq!==sequence)return;busy=false;render(operation==='generate'?'No se ha podido preparar una propuesta válida. Comprueba el modelo local y vuelve a intentarlo; no se ha enviado nada.':operation==='review'?'No se ha confirmado la revisión. Consulta de nuevo el correo antes de repetirla.':'No se ha podido consultar la propuesta guardada.');}
 }
 render();void request();
}
