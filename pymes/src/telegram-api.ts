import type { WorkspaceApiRequest,WorkspaceApiResponse,WorkspaceRepository,WorkspaceRuntimeSource } from './workspace-api.js';
import { TelegramError, tgRecord, tgExact, tgInt, tgChat } from './telegram-contract.js';
export async function handleTelegramRequest(request:WorkspaceApiRequest,parts:string[],repository:WorkspaceRepository,runtime?:WorkspaceRuntimeSource):Promise<WorkspaceApiResponse>{
 const token=request.authorization?.startsWith('Bearer ')?request.authorization.slice(7).trim():null,principal=token?repository.findSession(token):null;
 if(!principal)return {status:401,body:{error:'UNAUTHENTICATED'}};
 if(principal.tenantId!==parts[2]||principal.role!=='owner')return {status:403,body:{error:'PERMISSION_DENIED'}};
 const service=runtime?.telegram;if(!service||!runtime)return {status:404,body:{error:'TELEGRAM_NOT_CONFIGURED'}};
 const owner=runtime.principalIdForSession(principal);
 try{service.store.scope(principal.tenantId,owner);}catch{return {status:403,body:{error:'PERMISSION_DENIED'}};}
 const live=()=>{const p=token?repository.findSession(token):null;return !!p&&p.userId===owner&&p.tenantId===principal.tenantId&&p.role==='owner';};
 const done=(status:WorkspaceApiResponse['status'],body:Record<string,unknown>):WorkspaceApiResponse=>live()?{status,body}:{status:401,body:{error:'UNAUTHENTICATED'}};
 try{
  const identities=runtime.telegramIdentities;
  if(parts.length===5&&identities){
   const q=new URL(request.path,'http://127.0.0.1').searchParams;
   if(request.method==='GET'&&parts[4]==='identity'){
    if(q.size!==2||!q.has('botId')||!q.has('updateId')||!/^\d+$/.test(q.get('updateId')!))throw new TelegramError('TELEGRAM_IDENTITY_INVALID_INPUT');
    return done(200,{...identities.view(principal.tenantId,owner,tgChat(q.get('botId')),tgInt(Number(q.get('updateId'))),live)});
   }
   if(request.method==='GET'&&parts[4]==='identities'){
    if(q.size!==1||!q.has('contactId'))throw new TelegramError('TELEGRAM_IDENTITY_INVALID_INPUT');
    return done(200,{...identities.contacts(principal.tenantId,owner,q.get('contactId')!,live)});
   }
   if(request.method==='POST'&&parts[4]==='identity')return done(200,{...identities.command(principal.tenantId,owner,request.body,live)});
  }
  if(request.method==='GET'&&parts.length===4)return done(200,{...service.status()});
  if(request.method==='GET'&&parts.length===5&&parts[4]==='messages'){
   const q=new URL(request.path,'http://127.0.0.1').searchParams;if([...q.keys()].some(k=>!['q','limit','cursor'].includes(k)))throw new TelegramError('TELEGRAM_INVALID_QUERY');
   return done(200,{...service.store.page(q.get('q')??'',q.has('limit')?Number(q.get('limit')):20,q.get('cursor'))});
  }
  if(request.method==='POST'&&parts.length===5){
   if(parts[4]==='connect')return done(200,await service.configure(request.body,live));
   if(parts[4]==='disconnect')return done(200,await service.disconnect(request.body,live));
   if(parts[4]==='sync'){tgExact(tgRecord(request.body),[]);void service.sync(live).catch(()=>{});return done(202,{...service.status()});}
  }
  return {status:404,body:{error:'NOT_FOUND'}};
 }catch(error){const code=error instanceof TelegramError?error.message:'TELEGRAM_OPERATION_FAILED';
  return done(code==='TELEGRAM_INVALID_INPUT'||code==='TELEGRAM_INVALID_QUERY'||code==='TELEGRAM_IDENTITY_INVALID_INPUT'?400:code==='TELEGRAM_AUTH_CHANGED'?401:409,{error:code});
 }
}
