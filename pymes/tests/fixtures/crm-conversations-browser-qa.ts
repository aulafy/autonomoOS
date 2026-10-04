/** Isolated browser QA with synthetic HTTP Gmail or fake-email, never pilot data. */
import {createServer} from 'node:http';import {createInterface} from 'node:readline';
import {crmMailTraceFixture} from './crm-mail-trace-fixture.js';import {mailTaskFixture} from './mail-task-fixture.js';
import {handlePymesRequest} from '../../src/api-server.js';
const [dir,mode='gmail']=process.argv.slice(2);if(!dir||!['gmail','simulation','unknown'].includes(mode))throw new Error('QA_ARGUMENTS_INVALID');
const f=mode==='simulation'?await mailTaskFixture({dir}):await crmMailTraceFixture({dir,loseResponse:mode==='unknown'});
let task=(await f.client.mailTask(f.ref,'in1')).taskId;
if(!task){if('send' in f)task=await f.send();else{task=(await f.client.mailTask(f.ref,'in1',await f.prepare())).taskId!;const r=await f.client.emailWorkflow(task,'review');await f.client.emailWorkflow(task,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});await f.client.emailWorkflow(task,'execute');}}
if('send' in f){await f.inbox.syncNow();await f.client.crmResolve(f.ref,'sent1');}
const server=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];for await(const b of req)chunks.push(Buffer.from(b));const body=Buffer.concat(chunks);const r=await handlePymesRequest(f.api,new Request('http://127.0.0.1:8936'+req.url,{method:req.method,headers:req.headers as Record<string,string>,...(body.length?{body}:{})}),{allowedOrigins:['http://127.0.0.1:5177']});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());}catch{res.writeHead(500);res.end();}});
server.listen(8936,'127.0.0.1',()=>console.log(JSON.stringify({qa:true,mode,port:8936,task,tenant:'agency',syntheticToken:'owner-token-123456789'})));
const input=createInterface({input:process.stdin});input.on('line',async line=>{if(line==='status')console.log(JSON.stringify({calls:'send' in f?f.calls():f.sender.counts(),revision:(await f.client.crm({contactId:'contact'})).revision}));if(line==='error')f.runtime.source.crm!.close();if(line==='revoke')f.repo.revokeSession('owner-token-123456789');if(line==='stop'){server.close();input.close();await f.done();}});
