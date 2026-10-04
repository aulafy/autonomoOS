import {mailTaskFixture} from './mail-task-fixture.js';
let accepted!:(v:void)=>void;const barrier=new Promise<void>(r=>accepted=r);
const f=await mailTaskFixture({dir:process.argv[2]!,loseResponse:true,afterSend:()=>{process.send?.('provider-accepted');accepted();}});
const input=await f.prepare(),id=(await f.client.mailTask(f.ref,'in1',input)).taskId!,r=await f.client.emailWorkflow(id,'review');await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});
await f.client.emailWorkflow(id,'execute');await barrier;setInterval(()=>{},1000);
