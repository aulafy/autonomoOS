import {openWorkspaceRuntime} from '../../src/runtime-source.js';
import type {InferenceProvider,ProposedPlan} from '@agent-world/inference';
const phase=process.argv[3];
const keep=setInterval(()=>{},1000);
const provider:InferenceProvider={id:'fixture-local',capabilities:async()=>['structured_output'],health:async()=>({ok:true,provider:'fixture-local',endpoint:'http://127.0.0.1',authConfigured:false}),proposePlan:async context=>{
 if(phase==='inference'){process.send?.('inference');await new Promise(()=>{});}
 return {plan:{actions:context.availableActions.map(action=>({action,targetId:context.entities.find(e=>e.affordances.includes(action))!.id,parameters:{}}))} as ProposedPlan,rawText:'',latencyMs:0};
}};
const runtime=await openWorkspaceRuntime(process.argv[2]!,'agency',{provider});
runtime.source.createTask!('agency','owner',{id:'job',goal:'QA email workflow'});
await runtime.source.planTask!('agency','owner',{taskId:'job',workflow:'email-lead-v1'});
process.send?.('committed');
// Parent intentionally kills this process; no clean close/checkpoint.
void keep;
