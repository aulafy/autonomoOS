import type {WorkspaceApiRequest,WorkspaceApiResponse,WorkspaceRepository,WorkspaceRuntimeSource} from './workspace-api.js';
import {crmId,crmRef} from './crm-contract.js';
import {parseMailTaskInput} from './mail-task-contract.js';
import {MailTaskError} from './mail-task-service.js';
export async function handleMailTask(request:WorkspaceApiRequest,parts:string[],repo:WorkspaceRepository,runtime?:WorkspaceRuntimeSource):Promise<WorkspaceApiResponse>{
 const token=request.authorization?.startsWith('Bearer ')?request.authorization.slice(7).trim():null,p=token?repo.findSession(token):null;
 if(!p)return {status:401,body:{error:'UNAUTHENTICATED'}};
 const tenant=parts[2]!;if(tenant!==p.tenantId||p.role!=='owner')return {status:403,body:{error:'PERMISSION_DENIED'}};
 const service=runtime?.mailTasks;if(!service)return {status:404,body:{error:'MAIL_TASK_NOT_CONFIGURED'}};
 const owner=runtime!.principalIdForSession(p);if(owner!==service.inbox.owner||tenant!==service.tenant)return {status:403,body:{error:'MAIL_TASK_SCOPE_DENIED'}};
 const live=()=>{const current=repo.findSession(token!);return !!current&&current.userId===p.userId&&current.tenantId===tenant&&current.role==='owner';};
 try{
  if(request.method==='GET'&&parts.length===4){const q=new URLSearchParams(request.path.split('?')[1]??''),accountRef=crmRef(q.get('accountRef')),gmailId=crmId(q.get('gmailId'));const taskId=await service.view(owner,accountRef,gmailId,live);return {status:200,body:{tenantId:tenant,accountRef,gmailId,taskId,created:false}};}
  if(request.method!=='POST'||parts.length!==4)return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};
  let input;try{input=parseMailTaskInput(request.body);}catch{return {status:400,body:{error:'MAIL_TASK_INVALID_INPUT'}};}
  const result=await service.create(owner,input,live);return {status:result.created?201:200,body:{tenantId:tenant,accountRef:input.accountRef,gmailId:input.gmailId,...result}};
 }catch(e){return {status:e instanceof MailTaskError&&e.message==='MAIL_TASK_AUTH_CHANGED'?401:409,body:{error:e instanceof MailTaskError?e.message:'MAIL_TASK_OPERATION_FAILED'}};}
}
