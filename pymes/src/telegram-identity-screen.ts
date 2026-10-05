import type {WorkspaceClient} from './workspace-client.js';
import type {TelegramMessage,TelegramStatus} from './telegram-contract.js';
import type {TelegramIdentityView,TelegramIdentityCommand} from './telegram-identity-contract.js';
import type {CrmContact} from './crm-contract.js';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
const button=(text:string,fn:()=>void)=>{const b=el('button',text,'ui-button secondary');b.type='button';b.addEventListener('click',fn);return b;};
const expandedHistory=new Set<string>();
const renderedViews=new WeakMap<HTMLElement,string>();
interface Context {client:WorkspaceClient;status:TelegramStatus;message:TelegramMessage;dialog:HTMLDialogElement;current:()=>boolean;pause:()=>void;resume:()=>void;busy:(value:boolean)=>void;changed:()=>void;}
export async function renderTelegramIdentity(root:HTMLElement,ctx:Context){
 if(!root.childNodes.length)root.append(el('h4','Identidad actual del remitente'),el('p','Consultando identidad…','telegram-copy'));
 try{
  const v=await ctx.client.telegramIdentity(ctx.message.botId,ctx.message.updateId);
  if(!root.isConnected||!ctx.current())return;
  if(v.ownerId!==ctx.status.ownerId||v.connectionRevision!==ctx.status.revision||v.source.chatId!==ctx.message.chatId||v.source.senderId!==ctx.message.senderId)throw new Error('CONTEXT_CHANGED');
  const snapshot=JSON.stringify(v);if(renderedViews.get(root)===snapshot)return;renderedViews.set(root,snapshot);
  root.replaceChildren(el('h4','Identidad actual del remitente'));
  if(v.link&&v.contact){
   root.append(el('strong',v.contact.name),el('p',`Verificada por ${v.link.actor} el ${new Date(v.link.verifiedAt).toLocaleString('es-ES')}${v.contact.status==='archived'?' · Contacto archivado':''}`,'telegram-copy'));
   root.append(button('Abrir ficha del cliente',()=>window.dispatchEvent(new CustomEvent('crm:open-contact',{detail:{contactId:v.contact!.id}}))),button('Retirar vinculación',()=>{void edit(v,'revoke',ctx);}));
  }else root.append(el('p','Remitente sin vincular. Su nombre en Telegram no verifica quién es.','telegram-copy'),button('Vincular a un contacto',()=>{void edit(v,'verify',ctx);}));
  const history=el('details','','telegram-identity-history'),historyKey=JSON.stringify([v.ownerId,v.source.botId,v.source.chatId,v.source.senderId]);history.open=expandedHistory.has(historyKey);history.addEventListener('toggle',()=>{if(history.open){if(expandedHistory.size>128)expandedHistory.clear();expandedHistory.add(historyKey);}else expandedHistory.delete(historyKey);});history.append(el('summary',`Historial de identidad · ${v.audit.length} decisiones recientes`));
  for(const a of v.audit)history.append(el('p',`${a.operation==='verify'?'Vinculada':'Retirada'} · contacto ${a.contactId} · ${new Date(a.at).toLocaleString('es-ES')} · ${a.actor}${a.note?' · '+a.note:''}`,'telegram-copy'));root.append(history);
 }catch{if(root.isConnected&&ctx.current()){renderedViews.delete(root);root.replaceChildren(el('h4','Identidad actual del remitente'),el('p','No se pudo consultar la identidad. Actualiza la conexión para reintentar.','space-error'));}}
}
async function edit(v:TelegramIdentityView,operation:'verify'|'revoke',ctx:Context){
 if(!ctx.current())return;ctx.pause();const d=ctx.dialog;d.replaceChildren();d.setAttribute('aria-label',operation==='verify'?'Vincular identidad Telegram':'Retirar vinculación Telegram');
 const heading=el('h2',operation==='verify'?'Vincular identidad Telegram':'Retirar vinculación Telegram');
 d.append(heading,el('p',`Bot ${v.source.botId} · Chat ${v.source.chatId} · Remitente ${v.source.senderId}`,'telegram-copy'),el('p','La verificación corresponde a tu comprobación con la persona. No autoriza envíos ni crea oportunidades o seguimientos.','telegram-copy'));
 const form=el('form'),search=el('input'),pick=el('select'),note=el('textarea'),check=el('input'),feedback=el('p','','space-error');feedback.setAttribute('role','alert');
 const field=(name:string,input:HTMLElement)=>{const l=el('label',name);l.append(input);form.append(l);};
 let contacts:CrmContact[]=[],crmRevision=v.crmRevision,lookup=0,pending:TelegramIdentityCommand|null=null,submitting=false;
 if(operation==='verify'){
  search.type='search';search.maxLength=100;search.setAttribute('aria-label','Buscar contacto del CRM');pick.required=true;pick.setAttribute('aria-label','Contacto del CRM');field('Buscar contacto existente',search);field('Contacto',pick);
 }else form.append(el('p',`Se retirará la asociación con ${v.contact!.name}. El historial de decisiones y los mensajes se conservan.`));
 note.rows=3;note.maxLength=500;note.setAttribute('aria-label','Nota de verificación');field('Nota opcional (evita datos sensibles)',note);
 check.type='checkbox';check.required=true;field(operation==='verify'?'He comprobado que este remitente corresponde al contacto seleccionado':'Confirmo retirar esta vinculación',check);
 const controls=el('div','','telegram-actions'),cancel=button('Volver',()=>{if(submitting)return;lookup++;d.close();ctx.resume();}),save=el('button',operation==='verify'?'Confirmar vinculación':'Retirar esta vinculación','ui-button primary');save.type='submit';controls.append(cancel,save);form.append(feedback,controls);d.append(form);d.showModal();
 const placeholder=(text:string)=>{pick.replaceChildren();const o=el('option',text);o.value='';pick.append(o);};
 async function lookupContacts(){const seq=++lookup;check.checked=false;save.disabled=true;placeholder('Buscando contactos…');try{
  const result=await ctx.client.crm({query:search.value});if(seq!==lookup||!ctx.current()||!form.isConnected)return;
  contacts=result.contacts.filter(c=>c.status==='active');crmRevision=result.revision;placeholder('Selecciona un contacto');
  for(const c of contacts){const o=el('option',`${c.name} · ${c.id}`);o.value=c.id;pick.append(o);}
  feedback.textContent=result.contactsTruncated?'Hay más contactos: acota la búsqueda.':!contacts.length?'No hay contactos activos. Crea la ficha desde Clientes y vuelve aquí.':'';save.disabled=false;
 }catch{if(seq===lookup&&ctx.current()&&form.isConnected){contacts=[];placeholder('Consulta no disponible');feedback.textContent='No se pudo consultar el CRM. Cambia la búsqueda para reintentar.';}}}
 search.addEventListener('input',()=>{pending=null;void lookupContacts();});pick.addEventListener('change',()=>{check.checked=false;pending=null;});if(operation==='verify')void lookupContacts();
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(submitting||!ctx.current()||!check.checked)return;
  const contactId=operation==='verify'?pick.value:null;if(operation==='verify'&&!contacts.some(c=>c.id===contactId)){feedback.textContent='Selecciona un contacto de la consulta actual.';return;}
  const fields={expectedRevision:v.revision,crmRevision,connectionRevision:v.connectionRevision,botId:v.source.botId,updateId:v.source.updateId,operation,contactId,linkId:operation==='revoke'?v.link!.id:null,reviewed:true as const,note:note.value.trim()};
  if(!pending||JSON.stringify({...pending,commandId:undefined})!==JSON.stringify(fields))pending={commandId:crypto.randomUUID(),...fields};
  submitting=true;ctx.busy(true);lookup++;for(const control of [search,pick,note,check,cancel,save])control.disabled=true;feedback.textContent='Guardando decisión en el historial…';
  try{await ctx.client.telegramIdentityCommand(pending);if(!ctx.current())return;d.close();window.dispatchEvent(new Event('crm-changed'));ctx.changed();}
  catch{if(ctx.current()&&form.isConnected)feedback.textContent='No se confirmó la decisión. Puedes reintentar la misma solicitud; si los datos cambiaron, vuelve y revisa de nuevo.';}
  finally{submitting=false;ctx.busy(false);if(ctx.current()&&form.isConnected)for(const control of [search,pick,note,check,cancel,save])control.disabled=false;ctx.resume();}
 });
}
