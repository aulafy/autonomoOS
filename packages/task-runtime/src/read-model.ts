import type {TaskRuntimeState,GlobalTaskStatus,WorkUnitStatus,AttemptStatus,VerificationResult} from './types.js';
export interface RuntimeWorkspaceView {
 schemaVersion:1;revision:number;tasks:RuntimeTaskView[];hasMore:boolean;
}
export interface RuntimeTaskView {
 id:string;goal:string;status:GlobalTaskStatus;updatedAt:number;planVersion:number;
 counts:{total:number;succeeded:number;unknown:number};
 criteria:Array<{id:string;kind:string}>;
 units:Array<{id:string;title:string;status:WorkUnitStatus;dependencies:string[];criteria:Array<{id:string;kind:string}>;
 attempts:Array<{id:string;providerId:string;actorId:string;status:AttemptStatus;reportedOutcome?:'succeeded'|'failed'}>}>;
 verifications:Array<{attemptId?:string;results:VerificationResult[]}>;
}
/** Owner-only host read model. principalId must come from authenticated server
 * identity, never a request query parameter. No command, provider opaque metadata,
 * context, credential, permission or message payload is exported. */
export function readRuntimeWorkspace(state:TaskRuntimeState,principalId:string,options:{limit?:number;taskId?:string}={}):RuntimeWorkspaceView {
 const limit=options.limit??50;
 if(typeof principalId!=='string'||!principalId.trim()||!Number.isInteger(limit)||limit<1||limit>100) throw new Error('INVALID_RUNTIME_VIEW_REQUEST');
 const tasks=Object.values(state.tasks).filter(task=>task.owner===principalId&&(options.taskId===undefined||task.id===options.taskId)).sort((a,b)=>b.updatedAt-a.updatedAt||(a.id<b.id?-1:a.id>b.id?1:0));
 return {schemaVersion:1,revision:state.revision,hasMore:tasks.length>limit,tasks:tasks.slice(0,limit).map(task=>{
  const units=task.workUnitIds.map(id=>state.workUnits[id]).filter(unit=>unit?.taskId===task.id);
  return {id:task.id,goal:task.goal,status:task.status,updatedAt:task.updatedAt,planVersion:task.planVersion,
   counts:{total:units.length,succeeded:units.filter(u=>u.status==='succeeded').length,unknown:units.filter(u=>u.status==='unknown').length},
   criteria:task.successCriteria.map(c=>({id:c.id,kind:c.kind})),
   units:units.map(u=>({id:u.id,title:u.title,status:u.status,dependencies:u.dependencies.filter(id=>task.workUnitIds.includes(id)),criteria:u.successCriteria.map(c=>({id:c.id,kind:c.kind})),
    attempts:u.attemptIds.map(id=>state.attempts[id]).filter(a=>a?.taskId===task.id&&a.workUnitId===u.id).map(a=>({id:a.id,providerId:a.providerId,actorId:a.actorId,status:a.status,...(a.providerReportedOutcome===undefined?{}:{reportedOutcome:a.providerReportedOutcome})}))})),
   verifications:state.verifications.filter(v=>v.taskId===task.id).map(v=>({...v.attemptId===undefined?{}:{attemptId:v.attemptId},results:structuredClone(v.results)}))};
 })};
}
