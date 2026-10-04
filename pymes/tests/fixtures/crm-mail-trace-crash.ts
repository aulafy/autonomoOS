import {crmMailTraceFixture} from './crm-mail-trace-fixture.js';
const f=await crmMailTraceFixture({dir:process.argv[2],loseResponse:process.argv[3]==='unknown'}),task=await f.send();await f.inbox.syncNow();await f.client.crmResolve(f.ref,'sent1');const view=await f.client.crm({contactId:'contact'});process.send?.({task,view});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
