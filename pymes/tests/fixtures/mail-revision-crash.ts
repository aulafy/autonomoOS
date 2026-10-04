import {mailTaskFixture} from './mail-task-fixture.js';
const f=await mailTaskFixture({dir:process.argv[2]!}),input=await f.prepare(),previous=(await f.client.mailTask(f.ref,'in1',input)).taskId!,r=await f.client.emailWorkflow(previous,'review');
await f.client.emailWorkflow(previous,'decision',{bindingHash:r.review!.bindingHash,decision:'rejected'});
const next=await f.client.reviseEmailTask(previous,r.review!.bindingHash);
process.send?.({previous,next});setInterval(()=>{},1000);
