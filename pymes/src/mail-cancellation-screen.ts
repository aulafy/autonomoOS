import type {EmailWorkflowView} from './email-workflow.js';
import type {MailCancelInput} from './mail-cancellation-contract.js';
import type {WorkspaceClient} from './workspace-client.js';
const stateLabels:Record<string,string>={created:'Creado',planning:'Planificando',ready:'Preparado',running:'En curso',waiting:'En espera',verifying:'Comprobando',blocked:'Bloqueado',unknown:'Estado desconocido',cancelled:'Cancelado',completed:'Completado',failed:'Fallido'};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function cancellationActions(v:EmailWorkflowView):string{
 const c=v.cancellation,draft='draft' in v?v.draft:null;
 const saved=c&&draft?`<details class="rt-disclosure"><summary>Borrador conservado · solo lectura</summary><dl><dt>Destinatario</dt><dd>${draft.to.map(escape).join(', ')}</dd><dt>Asunto</dt><dd>${escape(draft.subject)}</dd></dl><pre style="white-space:pre-wrap">${escape(draft.body)}</pre></details>`:'';
 return `${c?`<aside class="rt-cancellation"><strong>CANCELLED · Cancelado por el profesional</strong><p>${escape(c.actor)} · ${escape(new Date(c.at).toLocaleString('es-ES'))}${c.reason?` · ${escape(c.reason)}`:''}</p>${v.decision?`<p>Aprobación anterior: ${v.decision.decision==='approved'?'Aprobado':'Rechazado'} · ${escape(v.decision.userId)}</p>`:''}<p>El historial y las aprobaciones anteriores se conservan. Este trabajo no puede enviarse.</p></aside>${saved}`:''}<div class="rt-email-actions">${v.cancellationState?.canCancel?'<button id="rt-cancel-job" type="button" class="rt-cancel">Cancelar trabajo</button>':''}${v.canReprepare?'<button id="rt-reprepare-job" type="button">Preparar nueva versión desde este correo</button>':''}</div><div id="rt-cancellation-dialog"></div>`;
}
export function cancellationPreview(v:EmailWorkflowView):string{
 const p=v.review?.payload??('draft' in v?v.draft:null),c=v.cancellationState;
 if(!c?.canCancel||!p)return '';
 return `<section class="rt-cancel-confirm" role="dialog" aria-modal="false" aria-labelledby="rt-cancel-title"><h4 id="rt-cancel-title">Cancelar trabajo pendiente</h4><dl><dt>Cliente / contacto</dt><dd>${escape(c.contactName??p.contactId)}</dd><dt>Destinatario</dt><dd>${p.to.map(escape).join(', ')}</dd><dt>Asunto</dt><dd>${escape(p.subject)}</dd><dt>Versión</dt><dd>${c.expectedRevision}</dd><dt>Estado registrado</dt><dd>${escape(stateLabels[v.globalTaskStatus??v.status]??v.globalTaskStatus??v.status)}</dd><dt>Aprobación</dt><dd>${v.decision?.decision==='approved'?'Sí · contenido aprobado':v.decision?.decision==='rejected'?'Rechazado':'Sin aprobación'}</dd></dl><p>Cancelar no equivale a borrar el historial. Se conservarán el borrador, las revisiones y las aprobaciones anteriores. No se enviará este trabajo.</p><label>Motivo (opcional)<textarea id="rt-cancel-reason" maxlength="500" rows="2"></textarea></label><div class="rt-email-actions"><button id="rt-cancel-confirm" type="button" class="rt-cancel">Cancelar este trabajo</button><button id="rt-cancel-dismiss" type="button">Volver</button></div><p id="rt-cancel-result" role="status" aria-live="polite"></p></section>`;
}
export function cancellationError(error:unknown):string{
 const code=error instanceof Error?error.message:'';
 if(code==='EMAIL_CANCEL_STALE')return 'El trabajo ha cambiado desde la revisión. Actualiza el estado y vuelve a comprobarlo antes de cancelar.';
 if(['EMAIL_CANCEL_C6_CLAIM','EMAIL_CANCEL_ACTIVE_ATTEMPT','EMAIL_CANCEL_UNKNOWN','EMAIL_CANCEL_EXTERNAL_DISPATCH'].includes(code))return 'No se puede cancelar: hay un intento o una evidencia de envío. Conserva el historial y consulta la reconciliación; no se reenviará.';
 return 'Cancelación no confirmada. Actualiza el estado o reintenta la misma petición; no se han sustituido los datos por ejemplos.';
}
export function mountCancellation(root:HTMLElement,v:EmailWorkflowView,client:WorkspaceClient,onChanged:(v:EmailWorkflowView)=>void,onOpen:(id:string)=>void,isCurrent:()=>boolean):void{
 const host=root.querySelector<HTMLElement>('#rt-cancellation-dialog');if(!host)return;
 let pending:MailCancelInput|null=null,inFlight=false;
 const busy=(value:boolean)=>{inFlight=value;root.querySelectorAll<HTMLButtonElement>('[data-email-operation],[data-email-open],#rt-cancel-job,#rt-reprepare-job,#rt-cancel-confirm,#rt-cancel-dismiss').forEach(b=>b.disabled=value);};
 root.querySelector<HTMLButtonElement>('#rt-cancel-job')?.addEventListener('click',()=>{
  if(inFlight||!isCurrent())return;host.innerHTML=cancellationPreview(v);pending=null;
  host.querySelector<HTMLButtonElement>('#rt-cancel-dismiss')!.onclick=()=>{if(!inFlight){host.replaceChildren();pending=null;}};
  host.querySelector<HTMLButtonElement>('#rt-cancel-confirm')!.onclick=async()=>{
   if(inFlight||!isCurrent()||!v.cancellationState?.canCancel)return;
   const field=host.querySelector<HTMLTextAreaElement>('#rt-cancel-reason')!,status=host.querySelector<HTMLElement>('#rt-cancel-result')!;
   pending??={requestId:crypto.randomUUID(),expectedRevision:v.cancellationState.expectedRevision,expectedStateHash:v.cancellationState.expectedStateHash,reason:field.value.trim()||null,confirmed:true};
   field.disabled=true;busy(true);status.textContent='Registrando la cancelación…';
   try{const next=await client.cancelEmailTask(v.taskId,pending);if(isCurrent()&&host.isConnected)onChanged(next);}
   catch(error){if(isCurrent()&&host.isConnected){busy(false);status.textContent=cancellationError(error);}}
   finally{inFlight=false;}
  };
  host.querySelector<HTMLButtonElement>('#rt-cancel-confirm')!.focus();
 });
 root.querySelector<HTMLButtonElement>('#rt-reprepare-job')?.addEventListener('click',()=>{
  if(inFlight||!isCurrent()||!v.canReprepare||!v.cancellation)return;
  host.innerHTML='<section class="rt-cancel-confirm" role="dialog" aria-labelledby="rt-new-title"><h4 id="rt-new-title">Preparar una nueva versión</h4><p>El trabajo cancelado permanecerá en el historial. Se creará otro borrador desde el mismo correo, sin reutilizar su aprobación. Revísalo antes de aprobar un nuevo envío.</p><button id="rt-new-confirm" type="button">Preparar nueva versión</button><button id="rt-new-dismiss" type="button">Volver</button><p id="rt-new-result" role="status"></p></section>';
  host.querySelector<HTMLButtonElement>('#rt-new-dismiss')!.onclick=()=>{if(!inFlight)host.replaceChildren();};
  const button=host.querySelector<HTMLButtonElement>('#rt-new-confirm')!;button.focus();button.onclick=async()=>{
   if(inFlight||!isCurrent())return;busy(true);button.disabled=true;host.querySelector<HTMLButtonElement>('#rt-new-dismiss')!.disabled=true;
   try{const id=await client.reprepareEmailTask(v.taskId,v.cancellation!.id);if(isCurrent()&&host.isConnected)onOpen(id);}
   catch{if(isCurrent()&&host.isConnected){busy(false);button.disabled=false;host.querySelector<HTMLButtonElement>('#rt-new-dismiss')!.disabled=false;host.querySelector('#rt-new-result')!.textContent='No se ha confirmado la nueva versión. Actualiza el estado y comprueba que el correo y el contacto siguen disponibles.';}}
   finally{inFlight=false;}
  };
 });
}
