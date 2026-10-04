import type {WorkspaceClient} from './workspace-client.js';
import type {SavedMailProposal} from './mail-assistance-contract.js';
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
const localTime=(at:number)=>{const d=new Date(at);return new Date(at-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export async function mountMailTaskEditor(parent:HTMLElement,client:WorkspaceClient,accountRef:string,gmailId:string,proposal:SavedMailProposal,sourceSubject:string,authorized:()=>boolean){
 const box=node('section','','mail-task-editor');parent.append(box);box.dataset.mailAiBusy='true';
 const current=()=>box.isConnected&&authorized();let working=false,contactSequence=0,linkCommandId=crypto.randomUUID();
 const status=node('p','Consultando cliente y trabajo…','mail-ai-status');status.setAttribute('role','status');box.append(status);
 function open(id:string){if(current())window.dispatchEvent(new CustomEvent('runtime:open-task',{detail:{taskId:id}}));}
 function existing(id:string){box.replaceChildren(node('h5','Trabajo guardado'),node('p','Continúa en el Centro de agentes para revisar el contenido exacto y aprobar su envío.','mail-ai-note'));const go=node('button','Abrir trabajo','gmail-button');go.type='button';go.onclick=()=>open(id);box.append(go);}
 try{
  const saved=await client.mailTask(accountRef,gmailId);if(!current())return;if(saved.taskId){existing(saved.taskId);return;}
  const resolution=await client.crmResolve(accountRef,gmailId);if(!current())return;
  const form=node('form','','mail-task-form'),fieldset=node('fieldset');
  const label=(name:string,control:HTMLElement)=>{const l=node('label',name);l.append(control);fieldset.append(l);};
  const search=node('input');search.type='search';search.placeholder='Nombre o email';search.maxLength=100;
  const find=node('button','Buscar cliente','gmail-button');find.type='button';
  const contacts=node('select');contacts.required=true;contacts.name='contactId';
  const to=node('input');to.name='to';to.type='email';to.required=true;to.maxLength=254;
  const subject=node('input');subject.name='subject';subject.required=true;subject.maxLength=500;subject.value=sourceSubject?'Re: '+sourceSubject.replace(/^(?:Re:\s*)+/i,''):proposal.proposal.draft.subject;
  const body=node('textarea');body.name='body';body.rows=8;body.maxLength=8000;body.required=true;body.value=proposal.proposal.draft.body;
  const follow=node('input');follow.name='followUpTitle';follow.required=true;follow.maxLength=300;follow.value='Revisar respuesta y próximos pasos';
  const due=node('input');due.name='followUpDueAt';due.type='datetime-local';due.required=true;due.min=localTime(Date.now());due.value=localTime(Date.now()+86400000);
  const reviewed=node('input');reviewed.type='checkbox';reviewed.required=true;reviewed.name='recipientReviewed';
  const helper=node('p','','mail-ai-note'),thread=node('p','','mail-ai-note');
  const save=node('button','Guardar trabajo para aprobación','gmail-button');save.type='submit';
  const cancel=node('button','Cerrar editor','gmail-button');cancel.type='button';cancel.onclick=()=>{if(!working)box.remove();};
  const crm=node('button','Crear o revisar cliente','gmail-button');crm.type='button';crm.onclick=()=>{if(current()&&!working)window.dispatchEvent(new CustomEvent('crm:open-mail',{detail:{accountRef,gmailId}}));};
  box.replaceChildren(node('h5','Preparar respuesta'),node('p','Edita el texto y confirma el cliente y su dirección. Guardar prepara el trabajo; la aprobación y el envío se harán después.','mail-ai-note'),form);
  label('Buscar en el CRM',search);fieldset.append(find);label('Cliente',contacts);fieldset.append(helper,crm);label('Destinatario',to);label('Asunto',subject);fieldset.append(thread);label('Respuesta',body);label('Próxima acción tras envío confirmado',follow);label('Fecha del seguimiento',due);label('He revisado el cliente, su dirección y este borrador',reviewed);
  fieldset.append(save,cancel);form.append(fieldset,status);
  const threadNote=()=>{thread.textContent=subject.value.replace(/^(?:Re:\s*)+/i,'')===sourceSubject.replace(/^(?:Re:\s*)+/i,'')?'Se conservará la conversación si el correo dispone de cabeceras de respuesta válidas.':'El asunto es diferente: se preparará un correo nuevo, vinculado a esta solicitud.';};subject.oninput=()=>{reviewed.checked=false;threadNote();};threadNote();
  for(const input of [to,body,follow,due])input.addEventListener('input',()=>reviewed.checked=false);
  async function addresses(){const id=contacts.value,seq=++contactSequence;to.value='';reviewed.checked=false;linkCommandId=crypto.randomUUID();if(!id)return;
   try{const v=await client.crm({contactId:id});if(!current()||seq!==contactSequence||contacts.value!==id)return;const emails=v.identities.filter(i=>i.active).map(i=>i.email);to.value=emails.length===1?emails[0]!:'';helper.textContent=emails.length?'Direcciones registradas: '+emails.join(', ')+'. Confirma la dirección correcta.':'Este cliente necesita una dirección registrada antes de preparar el trabajo.';}catch{if(current()&&seq===contactSequence)helper.textContent='No se han podido consultar las direcciones. Vuelve a seleccionar el cliente.';}
  }
  async function loadContacts(selected?:string){const seq=++contactSequence;contacts.replaceChildren(new Option('Selecciona un cliente',''));reviewed.checked=false;to.value='';
   try{const v=await client.crm({query:search.value,...(selected?{contactId:selected}:{})});if(!current()||seq!==contactSequence)return;for(const c of v.contacts.filter(c=>c.status==='active'))contacts.add(new Option(c.name,c.id));if(selected)contacts.value=selected;status.textContent=v.contactsTruncated?'Cartera recortada: busca el cliente por nombre o email.':'Selecciona un cliente y revisa la respuesta.';if(contacts.value)void addresses();}catch{if(current())status.textContent='No se ha podido consultar el CRM. Vuelve a buscar.';}
  }
  contacts.onchange=()=>void addresses();find.onclick=()=>{if(!working)void loadContacts();};search.oninput=()=>{contactSequence++;contacts.replaceChildren(new Option('Pulsa Buscar para consultar',''));to.value='';reviewed.checked=false;};
  form.onsubmit=async event=>{event.preventDefault();if(!current()||working||!reviewed.checked)return;working=true;fieldset.disabled=true;status.textContent='Guardando el cliente revisado y el trabajo…';
   const input={accountRef,gmailId,proposalId:proposal.id,contactId:contacts.value,to:to.value,subject:subject.value,body:body.value,recipientReviewed:true as const,followUpTitle:follow.value,followUpDueAt:new Date(due.value).getTime()};
   try{
    const view=await client.crm();if(!current())return;
    await client.crmLink({commandId:linkCommandId,expectedRevision:view.revision,accountRef,gmailId,contactId:input.contactId,reviewed:true});if(!current())return;
    const result=await client.mailTask(accountRef,gmailId,input);if(!current())return;
    if(!result.taskId)throw new Error('MAIL_TASK_NOT_CONFIRMED');existing(result.taskId);open(result.taskId);
   }catch{if(current()){status.textContent='No se ha confirmado el trabajo. Comprueba el cliente, la dirección registrada y el estado del correo; puedes consultar el trabajo antes de repetir.';const check=node('button','Comprobar trabajo guardado','gmail-button');check.type='button';check.onclick=async()=>{try{const saved=await client.mailTask(accountRef,gmailId);if(current()&&saved.taskId)existing(saved.taskId);}catch{if(current())status.textContent='No se ha confirmado ningún trabajo. Vuelve a consultar el correo.';}};status.append(check);}}
   finally{working=false;if(current())fieldset.disabled=false;}
  };
  await loadContacts(resolution.link?.contactId??undefined);
 }catch{if(current()){box.dataset.mailAiBusy='false';status.textContent='No se ha podido abrir la preparación. Comprueba la conexión del workspace y vuelve a intentarlo.';}}
}
