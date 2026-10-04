/** Isolated local browser QA; only synthetic email, inference and sender. */
import {createServer} from 'node:http';import {createInterface} from 'node:readline';import {randomUUID} from 'node:crypto';
import {mailTaskFixture} from './mail-task-fixture.js';import {handlePymesRequest} from '../../src/api-server.js';
const dir=process.argv[2];if(!dir)throw new Error('QA_DIRECTORY_REQUIRED');
const f=await mailTaskFixture({dir});let id=(await f.client.mailTask(f.ref,'in1')).taskId;
if(!id){const input=await f.prepare();id=(await f.client.mailTask(f.ref,'in1',input)).taskId;}
const server=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const method=req.method??'GET',body=Buffer.concat(chunks);const r=await handlePymesRequest(f.api,new Request('http://127.0.0.1:8935'+req.url,{method,headers:req.headers as Record<string,string>,...(body.length?{body}:{} )}),{allowedOrigins:['http://127.0.0.1:5177']});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text());}catch{res.writeHead(500);res.end();}});
server.listen(8935,'127.0.0.1',()=>console.log(JSON.stringify({qa:true,taskId:id,port:8935,tenant:'agency',syntheticToken:'owner-token-123456789'})));
const input=createInterface({input:process.stdin});input.on('line',async line=>{try{
 if(line==='status'){console.log(JSON.stringify({tasks:Object.values(f.runtime.kernel.snapshot().tasks).map(t=>({id:t.id,status:t.status})),sender:f.sender.counts()}));}
 if(line==='stale'){const task=(await f.client.mailTask(f.ref,'in1')).taskId!,v=f.runtime.source.email!.view(task,'owner');if(v.review)throw new Error('QA_DRAFT_ALREADY_REVIEWED');const p=v.draft!;f.runtime.source.email!.saveDraft(task,'owner',{to:p.to[0]!,subject:p.subject,body:p.body+'\nCambio ficticio '+randomUUID(),contactId:p.contactId});console.log('QA_DURABLE_DRAFT_CHANGED');}
 if(line==='stop'){server.close();input.close();await f.done();}
 }catch(e){console.log(e instanceof Error?e.message:'QA_ERROR');}});
