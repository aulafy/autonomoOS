/** Real Gmail adapter against a synthetic HTTP mailbox; never Google or Keychain. */
import {mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os'; import {join} from 'node:path';
import {GmailLocalConnector} from '../../src/gmail-local-connector.js';
import {GMAIL_SEND_SCOPE,GMAIL_READ_SCOPE} from '../../src/gmail-oauth.js';
import {TestVault} from './gmail-runtime.js';
import {InboxService} from '../../src/inbox-service.js'; import {InboxStore} from '../../src/inbox-store.js';
import {historyGmail,msg,NOW} from './gmail-history-fake.js'; import {P04_SCOPE,P04_OPTIONS} from './inbox-p04-scenarios.js';
import {mailTaskProposal} from './mail-task-fixture.js'; import {openWorkspaceRuntime} from '../../src/runtime-source.js';
import {WorkspaceApi,InMemoryWorkspaceRepository} from '../../src/workspace-api.js';
import {WorkspaceClient} from '../../src/workspace-client.js'; import {handlePymesRequest} from '../../src/api-server.js';
export async function crmMailTraceFixture(options:{dir?:string;loseResponse?:boolean}={}) {
 const own=!options.dir,dir=options.dir??mkdtempSync(join(tmpdir(),'p11-trace-')),path=join(dir,'synthetic-sent.json'),vault=new TestVault();
 let sent: {raw:string;threadId:string;calls:number}|null=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null,hidden=!!options.loseResponse;
 const history=historyGmail([msg('in1',{subject:'Consulta RC',body:'Necesito responsabilidad civil para mi actividad.'})]);
 const sentMessage=()=>msg('sent1',{labels:['SENT'],subject:'Re: Consulta RC',body:'Respuesta sintética aprobada.'});
 if(sent)history.add(sentMessage());
 const fetcher:typeof fetch=async(i,o)=>{
  const u=new URL(String(i));
  if(u.pathname.endsWith('/messages/send')){const b=JSON.parse(String(o?.body));sent={raw:b.raw,threadId:b.threadId,calls:(sent?.calls??0)+1};writeFileSync(path,JSON.stringify(sent),{mode:0o600});history.add(sentMessage());if(options.loseResponse)throw new Error('SYNTHETIC_RESPONSE_LOSS');return Response.json({id:'sent1'});}
  if(u.pathname.endsWith('/messages/sent1')&&u.searchParams.get('format')==='raw')return hidden?Response.json({error:{}},{status:503}):Response.json({id:'sent1',labelIds:['SENT'],threadId:sent?.threadId,raw:sent?.raw});
  if(u.pathname.endsWith('/messages')&&u.searchParams.get('q')?.includes('rfc822msgid'))return Response.json({messages:sent?[{id:'sent1'}]:[]});
  if(u.pathname.endsWith('/messages')&&u.searchParams.get('labelIds')==='SENT'&&!u.searchParams.has('includeSpamTrash'))return hidden?Response.json({},{status:503}):Response.json({messages:sent?[{id:'sent1'}]:[]});
  const response=await history.fetcher(i,o);
  if(u.pathname.endsWith('/messages/sent1')&&response.ok){const b=await response.json();b.threadId=sent?.threadId;if(b.payload)b.payload.headers=b.payload.headers.map((h:{name:string;value:string})=>({...h,value:h.name==='From'?'owner@example.test':h.name==='To'?'cliente@example.test':h.value}));return Response.json(b);}
  return response;
 };
 const gmail=new GmailLocalConnector('owner','agency',join(dir,'claims.db'),vault,async()=>{},fetcher);
 const credential={accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,clientId:'test.apps.googleusercontent.com',clientSecret:'synthetic-client',account:'owner@example.test',subject:'account-one',scopes:[GMAIL_SEND_SCOPE,GMAIL_READ_SCOPE,'openid','email'],generation:'b'.repeat(64)};
 await vault.set(gmail.oauth.credentialRef,JSON.stringify(credential));await gmail.status('owner');
 const store=new InboxStore(join(dir,'inbox.db'),()=>NOW),inbox=new InboxService(gmail.oauth,store,P04_SCOPE,fetcher,P04_OPTIONS,()=>NOW);await inbox.syncNow();
 const open=()=>openWorkspaceRuntime(join(dir,'runtime.db'),'agency',{gmail,gmailInbox:inbox,mailProposalProvider:{id:'synthetic-local',proposeJson:async()=>({value:mailTaskProposal(),model:'fixture',latencyMs:1})}});
 let runtime=await open();const repo=new InMemoryWorkspaceRepository();for(const id of ['owner','other'])repo.addSession(id+'-token-123456789',{tenantId:'agency',userId:id,role:'owner'});let api=new WorkspaceApi(repo,undefined,runtime.source);
 const client=new WorkspaceClient({baseUrl:'http://127.0.0.1',tenantId:'agency',token:'owner-token-123456789'},(i,o)=>handlePymesRequest(api,new Request(String(i),o)));
 const ref=(await inbox.context(null)).info!.accountRef;
 return {dir,ref,vault,credential,gmail,inbox,store,repo,client,get runtime(){return runtime;},get api(){return api;},calls:()=>sent?.calls??0,reveal:()=>{hidden=false;},reopen:async()=>{runtime.close();runtime=await open();api=new WorkspaceApi(repo,undefined,runtime.source);},send:async()=>{
  await client.crmCommand({commandId:'contact',expectedRevision:0,operation:{type:'contact.create',id:'contact',name:'Cliente ficticio',email:'cliente@example.test',phone:'',notes:'',relationship:'prospect'}});
  await client.crmResolve(ref,'in1');const p=(await client.mailAssistance(ref,'in1','generate')).proposal!;await client.mailAssistance(ref,'in1','review',{proposalId:p.id,decision:'accepted'});
  const task=(await client.mailTask(ref,'in1',{accountRef:ref,gmailId:'in1',proposalId:p.id,contactId:'contact',to:'cliente@example.test',subject:'Re: Consulta RC',body:'Respuesta sintética aprobada.',recipientReviewed:true,followUpTitle:'Llamar',followUpDueAt:Date.now()+86400000})).taskId!;
  const r=await client.emailWorkflow(task,'review');await client.emailWorkflow(task,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});await client.emailWorkflow(task,'execute');return task;
 },done:async()=>{await inbox.close();runtime.close();gmail.close();store.close();if(own)rmSync(dir,{recursive:true,force:true});}};
}
