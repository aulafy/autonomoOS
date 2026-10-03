import type {RuntimeWorkspaceView} from '@agent-world/task-runtime';
const statuses=['created','planning','ready','running','waiting','verifying','completed','failed','blocked','unknown','cancelled'];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=10000;
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const array=(v:unknown):v is unknown[]=>Array.isArray(v)&&v.length<=10000;
const criteria=(v:unknown)=>array(v)&&v.every(c=>object(c)&&text(c.id)&&['test','http','file','schema','observation','human-approval','custom'].includes(String(c.kind)));
/** Validate before rendering. Returned data is detached and API size limits still apply. */
export function parseRuntimeView(body:unknown,tenantId:string):RuntimeWorkspaceView {
 const bad=()=>{throw new Error('INVALID_RUNTIME_RESPONSE');};
 if(!object(body)||body.tenantId!==tenantId||body.schemaVersion!==1||!integer(body.revision)||typeof body.hasMore!=='boolean'||!array(body.tasks)||body.tasks.length>100) return bad();
 const taskIds=new Set<string>();
 for(const t of body.tasks){
  if(!object(t)||!text(t.id)||taskIds.has(t.id)||!text(t.goal)||!statuses.includes(String(t.status))||!integer(t.updatedAt)||!integer(t.planVersion)||!criteria(t.criteria)||!object(t.counts)||!array(t.units)||!array(t.verifications))return bad();
  taskIds.add(t.id);const unitIds=new Set<string>(),attemptIds=new Set<string>();let succeeded=0,unknown=0;
  for(const u of t.units){
   if(!object(u)||!text(u.id)||unitIds.has(u.id)||!text(u.title)||!['planned','ready','running','waiting','verifying','succeeded','failed','blocked','unknown','cancelled'].includes(String(u.status))||!array(u.dependencies)||!u.dependencies.every(text)||!criteria(u.criteria)||!array(u.attempts))return bad();
   unitIds.add(u.id);succeeded+=Number(u.status==='succeeded');unknown+=Number(u.status==='unknown');
   for(const a of u.attempts){if(!object(a)||!text(a.id)||attemptIds.has(a.id)||!text(a.providerId)||!text(a.actorId)||!['created','reserved','dispatching','running','reported','verifying','succeeded','failed','unknown','cancelled'].includes(String(a.status))||(a.reportedOutcome!==undefined&&!['succeeded','failed'].includes(String(a.reportedOutcome))))return bad();attemptIds.add(a.id);}
  }
  for(const u of t.units as Record<string,unknown>[])if((u.dependencies as string[]).some(id=>!unitIds.has(id)))return bad();
  if(t.counts.total!==t.units.length||t.counts.succeeded!==succeeded||t.counts.unknown!==unknown)return bad();
  for(const v of t.verifications){if(!object(v)||(v.attemptId!==undefined&&(!text(v.attemptId)||!attemptIds.has(v.attemptId)))||!array(v.results))return bad();for(const r of v.results)if(!object(r)||!text(r.criterionId)||!['satisfied','unsatisfied','unknown'].includes(String(r.status))||!array(r.evidenceRefs)||!r.evidenceRefs.length||!r.evidenceRefs.every(text))return bad();}
 }
 return structuredClone({schemaVersion:1,revision:body.revision,hasMore:body.hasMore,tasks:body.tasks}) as RuntimeWorkspaceView;
}
