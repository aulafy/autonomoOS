import type {WorkspaceApiRequest,WorkspaceApiResponse,WorkspaceRepository,WorkspaceRuntimeSource} from './workspace-api.js';
import {MailAssistanceError} from './mail-assistance-service.js';
import {crmId,crmRef,crmRecord,crmEnum} from './crm-contract.js';
/** This API cannot send, approve effects or mutate CRM. Model proposals have no execution authority. */
export async function handleMailAssistance(request:WorkspaceApiRequest,parts:string[],repo:WorkspaceRepository,runtime:WorkspaceRuntimeSource|undefined):Promise<WorkspaceApiResponse>{
 const token=request.authorization?.startsWith('Bearer ')?request.authorization.slice(7).trim():null,principal=token?repo.findSession(token):null;
 if(!principal)return {status:401,body:{error:'UNAUTHENTICATED'}};
 const tenant=parts[2]!;if(tenant!==principal.tenantId||principal.role!=='owner')return {status:403,body:{error:'PERMISSION_DENIED'}};
 if(!runtime?.mailAssistance)return {status:404,body:{error:'MAIL_AI_NOT_CONFIGURED'}};
 const owner=runtime.principalIdForSession(principal),service=runtime.mailAssistance;
 if(owner!==service.inbox.owner||tenant!==service.inbox.scope.tenant)return {status:403,body:{error:'MAIL_AI_OWNER_DENIED'}};
 const live=()=>{const p=repo.findSession(token!);return !!p&&p.userId===principal.userId&&p.tenantId===tenant&&p.role==='owner';};
 try{
  let accountRef:string,gmailId:string,proposal;
  if(request.method==='GET'&&parts.length===4){const q=new URLSearchParams(request.path.split('?')[1]??'');accountRef=crmRef(q.get('accountRef'));gmailId=crmId(q.get('gmailId'));proposal=await service.view(owner,accountRef,gmailId,live);}
  else if(request.method==='POST'&&parts.length===5){
   const b=crmRecord(request.body);accountRef=crmRef(b.accountRef);gmailId=crmId(b.gmailId);
   if(parts[4]==='generate'&&Object.keys(b).sort().join(',')==='accountRef,gmailId')proposal=await service.generate(owner,accountRef,gmailId,live);
   else if(parts[4]==='review'&&Object.keys(b).sort().join(',')==='accountRef,decision,gmailId,proposalId')proposal=await service.decide(owner,accountRef,gmailId,crmId(b.proposalId),crmEnum(b.decision,['accepted','rejected']),live);
   else return {status:400,body:{error:'MAIL_AI_INVALID_REQUEST'}};
  }else return {status:404,body:{error:'NOT_FOUND'}};
  return live()?{status:200,body:{tenantId:tenant,accountRef,gmailId,proposal,localOnly:true}}:{status:401,body:{error:'UNAUTHENTICATED'}};
 }catch(e){const code=e instanceof MailAssistanceError?e.message:'MAIL_AI_OPERATION_FAILED';return {status:code==='MAIL_AI_AUTH_CHANGED'?401:409,body:{error:code}};}
}
