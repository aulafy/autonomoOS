/** Synthetic inbox + actual configured local model, for visual QA. Never uses Gmail OAuth. */
import {createServer} from 'node:http';import {mkdirSync} from 'node:fs';import {join} from 'node:path';
import {InboxStore} from '../../src/inbox-store.js';import {InboxService} from '../../src/inbox-service.js';import {openWorkspaceRuntime} from '../../src/runtime-source.js';
import {WorkspaceApi,InMemoryWorkspaceRepository} from '../../src/workspace-api.js';import {handlePymesRequest} from '../../src/api-server.js';
import {historyGmail,msg,credentialSource,NOW} from './gmail-history-fake.js';import {P04_SCOPE,P04_OPTIONS} from './inbox-p04-scenarios.js';
const dir=process.env.P07_QA_DIR;if(!dir)throw new Error('P07_QA_DIR_REQUIRED');mkdirSync(dir,{recursive:true,mode:0o700});process.umask(0o077);
const store=new InboxStore(join(dir,'inbox.db'),()=>NOW),cred=credentialSource();const gmail=historyGmail([msg('p07-mail',{subject:'Consulta de RC profesional · datos ficticios',body:'Soy electricista autónomo y necesito un seguro de responsabilidad civil para mi actividad profesional. ¿Qué información hace falta para preparar una propuesta? Mi seguro actual vence el mes que viene. Este mensaje es una prueba con datos ficticios.'})]);
const inbox=new InboxService(cred.source,store,P04_SCOPE,gmail.fetcher,P04_OPTIONS,()=>NOW);await inbox.syncNow();
const runtime=await openWorkspaceRuntime(join(dir,'runtime.db'),'agency',{gmailInbox:inbox,fakeEmail:true}),repo=new InMemoryWorkspaceRepository(),api=new WorkspaceApi(repo,undefined,runtime.source);
if(!runtime.source.crm!.store.contact('owner','p07-client'))runtime.source.crm!.command('agency','owner',{commandId:'p07-create-client',expectedRevision:runtime.source.crm!.store.revision('owner'),operation:{type:'contact.create',id:'p07-client',name:'Electricista · datos ficticios',email:'cliente@example.test',phone:'',notes:'Cuenta sintética para revisar el recorrido completo.',relationship:'prospect'}});
api.addSession('p07-synthetic-session-123456789',{tenantId:'agency',userId:'owner',role:'owner'});
const server=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];let size=0;for await(const b of req){size+=b.length;if(size>262144)throw new Error('REQUEST_TOO_LARGE');chunks.push(b);}const body=Buffer.concat(chunks),request=new Request('http://127.0.0.1:8935'+req.url,{method:req.method,headers:req.headers as Record<string,string>,...(body.length?{body:new Uint8Array(body)}:{})});const response=await handlePymesRequest(api,request,{allowedOrigins:['http://127.0.0.1:5177']});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('QA_REQUEST_FAILED');}});
server.listen(8935,'127.0.0.1',()=>console.log('P07 synthetic workflow QA on 127.0.0.1:8935'));
async function close(){server.close();await inbox.close();runtime.close();store.close();}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
