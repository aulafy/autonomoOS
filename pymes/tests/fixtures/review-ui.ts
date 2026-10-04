/** Disposable visual QA: fictional contacts, synthetic model and local fake sender. */
import {createServer} from 'node:http';
import {mailTaskFixture} from './mail-task-fixture.js';
import {handlePymesRequest} from '../../src/api-server.js';
import {defineEmailLeadUnits} from '../../src/job-planner.js';
const dir=process.env.P09_QA_DIR;if(!dir)throw new Error('P09_QA_DIR_REQUIRED');process.umask(0o077);
const f=await mailTaskFixture({dir,loseResponse:true});
const input=await f.prepare(),id=(await f.client.mailTask(f.ref,'in1',input)).taskId!,r=await f.client.emailWorkflow(id,'review');
await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'rejected'});
const next=await f.client.reviseEmailTask(id,r.review!.bindingHash),r2=await f.client.emailWorkflow(next,'review');await f.client.emailWorkflow(next,'decision',{bindingHash:r2.review!.bindingHash,decision:'approved'});await f.client.emailWorkflow(next,'execute');
for(let i=0;i<65;i++)f.runtime.source.createTask!('agency','owner',{id:'review-job-'+String(i).padStart(3,'0'),goal:i===5?'<img src=x onerror=alert(1)> · datos ficticios':`Consulta ficticia ${i+1} · ${i%2?'Póliza de José':'Seguro de hogar'}`});
for(const [id,title,decision] of [['pending','Respuesta ficticia · falta tu aprobación',null],['approved','Respuesta ficticia · aprobada sin enviar','approved'],['rejected','Respuesta ficticia · requiere corrección','rejected']] as const){
 f.runtime.source.createTask!('agency','owner',{id,goal:title});const task=f.runtime.kernel.snapshot().tasks[id]!;
 f.runtime.kernel.apply({id:'planning-'+id,taskId:id,at:Date.now(),type:'GlobalTaskPlanningStarted'},f.runtime.kernel.snapshot().revision);
 f.runtime.kernel.apply({id:'plan-'+id,taskId:id,at:Date.now(),type:'PlanCommitted',planVersion:1,workUnits:defineEmailLeadUnits(task)},f.runtime.kernel.snapshot().revision);
 const review=await f.client.emailWorkflow(id,'review');if(decision)await f.client.emailWorkflow(id,'decision',{bindingHash:review.review!.bindingHash,decision});
}
const server=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];let size=0;for await(const b of req){size+=b.length;if(size>262144)throw new Error('REQUEST_TOO_LARGE');chunks.push(b);}const body=Buffer.concat(chunks),request=new Request('http://127.0.0.1:8935'+req.url,{method:req.method,headers:req.headers as Record<string,string>,...(body.length?{body:new Uint8Array(body)}:{})}),response=await handlePymesRequest(f.api,request,{allowedOrigins:['http://127.0.0.1:5177']});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('QA_REQUEST_FAILED');}});
server.listen(8935,'127.0.0.1',()=>console.log('P09 synthetic review QA on 127.0.0.1:8935'));
async function close(){server.close();await f.done();}process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
