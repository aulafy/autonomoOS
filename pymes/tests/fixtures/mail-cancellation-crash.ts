import {mailTaskFixture} from './mail-task-fixture.js';
import type {MailCancelInput} from '../../src/mail-cancellation-contract.js';
const [dir,stage]=process.argv.slice(2);let id='',input:MailCancelInput;
const pause=()=>{process.send?.({id,input,stage});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
const f=await mailTaskFixture({dir,cancellationHooks:{[stage!]:pause}}),prepared=await f.prepare();id=(await f.client.mailTask(f.ref,'in1',prepared)).taskId!;
const r=await f.client.emailWorkflow(id,'review');await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});
const c=(await f.client.emailWorkflow(id)).cancellationState!;input={requestId:'synthetic-crash-cancel',expectedRevision:c.expectedRevision,expectedStateHash:c.expectedStateHash,reason:null,confirmed:true};
f.runtime.source.email!.cancel(id,'owner',input);
throw new Error('CRASH_HOOK_NOT_REACHED');
