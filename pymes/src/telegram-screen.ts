import type {WorkspaceClient} from './workspace-client.js';
import {parseTelegramConfig,type TelegramConfigInput,type TelegramStatus,type TelegramPage} from './telegram-contract.js';
import {telegramSelection,telegramProblemText} from './telegram-view.js';import './telegram-screen.css';
const root=document.getElementById('telegram-screen')!,dialog=document.createElement('dialog');dialog.className='telegram-dialog';dialog.setAttribute('aria-label','Configurar recepción de Telegram');document.body.append(dialog);
let client:WorkspaceClient|null=null,status:TelegramStatus|null=null,page:TelegramPage|null=null,epoch=0,busy=false,query='',searchDraft='',cursor:string|null=null,selection:number|null=null,timer:ReturnType<typeof setTimeout>|null=null,failed='';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
const button=(text:string,fn:()=>void,cls='ui-button secondary')=>{const b=el('button',text,cls);b.type='button';b.addEventListener('click',fn);return b;};
function clearTimer(){if(timer)clearTimeout(timer);timer=null;}
function schedule(){clearTimer();if(client&&location.hash==='#telegram-screen'&&!busy&&!dialog.open)timer=setTimeout(()=>{void load(true);},5000);}
function render(){
 root.replaceChildren();const header=el('header','','space-heading'),copy=el('div');copy.append(el('span','CONEXIÓN COMPARTIDA · BOT API','eyebrow'),el('h2','Telegram'),el('p','Mensajes enviados a tu bot, conservados en tu Mac.'));header.append(copy);root.append(header);
 header.append(button('Configurar recepción',configure));header.querySelector('button')!.disabled=!client||!status||busy;
 root.append(el('p','Este conector recibe texto de las conversaciones autorizadas. No lee tu cuenta personal, descarga adjuntos ni envía respuestas.','telegram-copy'));
 if(failed||!client||!status){const notice=el('div',failed||(!client?'Conecta tu espacio de trabajo para consultar Telegram.':'Consultando el conector…'),'space-notice');notice.setAttribute('role',failed?'alert':'status');root.append(notice,button('Actualizar conexión',()=>{void load();}));return;}
 const top=el('div','','telegram-status');top.append(el('strong',status.problem?'Recepción con incidencia':status.running?'Recibiendo…':status.enabled?'Recepción activa':status.bot?'Recepción desconectada':'Bot sin conectar'));
 top.append(el('span',status.bot?`@${status.bot.username} · ${status.allowedChatIds.length} ${status.allowedChatIds.length===1?'conversación autorizada':'conversaciones autorizadas'}`:'Configura un bot dedicado para empezar.'));
 top.append(el('small',`Revisión ${status.revision} · ${status.messageCount} eventos de texto conservados · ${status.ignoredCount} ${status.ignoredCount===1?'actualización descartada':'actualizaciones descartadas'}`));
 top.append(el('small',status.lastSyncAt?`Última recepción comprobada: ${new Date(status.lastSyncAt).toLocaleString('es-ES')}`:'Todavía no se ha completado ninguna recepción.'));
 if(status.problem){const error=el('p',telegramProblemText[status.problem],'space-error');error.setAttribute('role','alert');top.append(error);}
 if(status.retryAt&&status.retryAt>Date.now())top.append(el('small',`Próximo intento a partir de ${new Date(status.retryAt).toLocaleTimeString('es-ES')}`));root.append(top);
 const actions=el('div','','telegram-actions'),refresh=button('Recibir ahora',()=>{void receive();});refresh.disabled=busy||!status.enabled||status.running;actions.append(refresh);
 if(status.enabled){const disconnect=button('Desconectar recepción',disconnectConfirmation);disconnect.disabled=busy;actions.append(disconnect);}root.append(actions);
 const search=el('form','','telegram-search'),input=el('input');input.type='search';input.setAttribute('aria-label','Buscar mensajes Telegram');input.placeholder='Buscar en el texto recibido';input.value=searchDraft;input.addEventListener('input',()=>{searchDraft=input.value;});const submit=el('button','Buscar','ui-button secondary');submit.type='submit';search.append(input,submit);search.addEventListener('submit',e=>{e.preventDefault();query=input.value.slice(0,100);searchDraft=query;cursor=null;selection=null;void load();});root.append(search);
 const grid=el('div','','telegram-inbox'),list=el('div','','telegram-list'),detail=el('article','','telegram-detail');detail.setAttribute('aria-live','polite');
 for(const item of page?.items??[]){const row=button('',()=>{selection=item.updateId;render();},'telegram-row');row.setAttribute('aria-label',`Abrir mensaje de ${item.senderName}, actualización ${item.updateId}`);row.classList.toggle('selected',selection===item.updateId);row.append(el('strong',item.senderName),el('small',`${new Date(item.at).toLocaleString('es-ES')}${item.edited?' · Edición':''}`),el('span',item.text.slice(0,140)));list.append(row);}
 if(!page?.items.length)list.append(el('p',query?'No hay mensajes que coincidan con esta búsqueda.':'No hay mensajes recibidos para las conversaciones autorizadas.','telegram-copy'));
 const selected=page?telegramSelection(status,page,selection):null;if(!selected){selection=null;detail.append(el('h3','Selecciona un mensaje'),el('p','El detalle solo muestra un evento visible y autorizado de esta página.'));}
 else {detail.append(el('span',selected.edited?'EDICIÓN RECIBIDA · HISTORIAL CONSERVADO':'MENSAJE RECIBIDO','eyebrow'),el('h3',selected.senderName),el('p','Identidad de Telegram · Todavía no vinculada a un contacto del CRM.','telegram-copy'),el('p',`Chat ${selected.chatId} · Mensaje ${selected.messageId} · Actualización ${selected.updateId}`,'telegram-copy'),el('div',selected.text,'telegram-body'),el('p','Contenido externo: no autoriza acciones ni cambia las reglas del asistente.','telegram-copy'));}
 grid.append(list,detail);root.append(grid);const paging=el('div','','telegram-actions');
 if(cursor)paging.append(button('Volver a los recientes',()=>{cursor=null;selection=null;void load();}));
 if(page?.nextCursor)paging.append(button('Ver anteriores',()=>{cursor=page!.nextCursor;selection=null;void load();}));root.append(paging);
}
async function load(quiet=false){
 if(quiet&&root.contains(document.activeElement)&&document.activeElement?.tagName==='INPUT'){schedule();return;}
 if(busy||dialog.open)return;clearTimer();const current=client,ticket=++epoch,wanted=selection;if(!quiet){status=null;page=null;selection=null;failed='';render();}if(!current)return;
 try{const [s,p]=await Promise.all([current.telegramStatus(),current.telegramMessages(query,cursor)]);if(ticket!==epoch||current!==client)return;
  if(s.revision!==p.connectionRevision||s.ownerId!==p.ownerId||s.bot?.id!==(p.botId??undefined)||p.items.some(m=>!s.allowedChatIds.includes(m.chatId)))throw new Error('TELEGRAM_CONTEXT_CHANGED');status=s;page=p;selection=telegramSelection(s,p,wanted)?.updateId??null;failed='';
 }catch(error){if(ticket!==epoch||current!==client)return;status=null;page=null;selection=null;failed=error instanceof Error&&error.message==='TELEGRAM_NOT_CONFIGURED'?'El conector Telegram no está disponible en esta instalación. Consulta la configuración de tu equipo.':'No se pudo consultar Telegram. No se muestran datos de ejemplo. Actualiza para reintentar.';if(error instanceof Error&&error.message==='TELEGRAM_CURSOR_INVALID')cursor=null;}
 render();schedule();
}
async function receive(){if(!client||busy)return;busy=true;render();const current=client,ticket=epoch;try{await current.telegramSync();}catch{if(current===client&&ticket===epoch)failed='No se pudo iniciar la recepción. Revisa el estado de la conexión.';}finally{if(current===client&&ticket===epoch){busy=false;if(failed){render();schedule();}else void load();}}}
function configure(){
 if(!client||!status||busy)return;clearTimer();dialog.replaceChildren();dialog.setAttribute('aria-label','Configurar recepción de Telegram');const current=client,ticket=epoch,revision=status.revision;let command:TelegramConfigInput|null=null;
 dialog.append(el('h2','Configurar recepción de Telegram'),el('p','Usa un bot dedicado creado con BotFather. El token se guarda en el llavero del Mac; no se añade a la organización exportada.','telegram-copy'));
 const form=el('form'),token=el('input'),chats=el('textarea'),consent=el('input');token.type='password';token.autocomplete='off';token.required=true;token.setAttribute('aria-label','Token del bot Telegram');chats.setAttribute('aria-label','Identificadores de chats autorizados');chats.required=true;chats.value=status.allowedChatIds.join('\n');chats.rows=4;consent.type='checkbox';consent.required=true;
 const field=(text:string,input:HTMLElement)=>{const l=el('label',text);l.append(input);form.append(l);};field('Token del bot',token);field('Chats autorizados (un identificador numérico por línea)',chats);field('Autorizo guardar el texto de estas conversaciones en mi Mac',consent);
 form.append(el('p','Comprueba cada identificador con su participante antes de añadirlo. Los mensajes de otros chats se descartan sin guardar su contenido.','telegram-copy'));
 const feedback=el('p','','space-error');feedback.setAttribute('role','alert');const controls=el('div','','telegram-actions'),cancel=button('Volver',()=>{token.value='';command=null;dialog.close();schedule();}),save=el('button','Conectar este bot','ui-button primary');save.type='submit';controls.append(cancel,save);form.append(feedback,controls);dialog.append(form);dialog.showModal();
 form.addEventListener('submit',async e=>{e.preventDefault();if(busy||current!==client||ticket!==epoch)return;
  try{const proposed=parseTelegramConfig({commandId:'candidate',expectedRevision:revision,token:token.value.trim(),allowedChatIds:chats.value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean),consent:consent.checked});if(!command||JSON.stringify({...command,commandId:'candidate'})!==JSON.stringify(proposed))command={...proposed,commandId:crypto.randomUUID()};}catch{feedback.textContent='Comprueba el token, los identificadores únicos y la autorización.';return;}
  busy=true;for(const control of [token,chats,consent,cancel,save])control.disabled=true;feedback.textContent='Verificando el bot y guardando la conexión…';
  try{await current.connectTelegram(command!);if(current!==client||ticket!==epoch)return;token.value='';command=null;dialog.close();busy=false;cursor=null;query='';searchDraft='';void load();}
  catch(error){if(current!==client||ticket!==epoch)return;feedback.textContent=error instanceof Error&&telegramProblemText[error.message]?telegramProblemText[error.message]!: 'No se pudo confirmar la conexión. Reintenta la misma petición o vuelve a cargar si otra sesión cambió la configuración.';}
  finally{if(current===client&&ticket===epoch){busy=false;for(const control of [token,chats,consent,cancel,save])control.disabled=false;}}
 });
}
function disconnectConfirmation(){if(!client||!status||busy)return;clearTimer();dialog.replaceChildren();dialog.setAttribute('aria-label','Desconectar recepción');const current=client,ticket=epoch,input={commandId:crypto.randomUUID(),expectedRevision:status.revision};
 dialog.append(el('h2','Desconectar recepción'),el('p',`Dejarás de recibir mensajes de @${status.bot?.username}. El historial local se conserva y ningún trabajo del runtime se cancela.`));
 const error=el('p','','space-error');error.setAttribute('role','alert');const cancel=button('Volver',()=>{dialog.close();schedule();}),confirm=button('Desconectar este bot',()=>{void run();},'ui-button primary');dialog.append(error,cancel,confirm);dialog.showModal();
 async function run(){if(busy||current!==client||ticket!==epoch)return;busy=true;cancel.disabled=confirm.disabled=true;try{await current!.disconnectTelegram(input);if(current===client&&ticket===epoch){dialog.close();busy=false;void load();}}catch{if(current===client&&ticket===epoch)error.textContent='No se pudo confirmar la desconexión. Reintenta o actualiza la conexión.';}finally{if(current===client&&ticket===epoch){busy=false;cancel.disabled=confirm.disabled=false;}}}
}
export function setTelegramClient(value:WorkspaceClient|null){epoch++;client=value;busy=false;dialog.close();dialog.replaceChildren();status=null;page=null;selection=null;cursor=null;query='';searchDraft='';clearTimer();if(location.hash==='#telegram-screen')void load();else render();}
dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();else {dialog.replaceChildren();schedule();}});
window.addEventListener('hashchange',()=>{if(location.hash==='#telegram-screen')void load();else clearTimer();});render();
