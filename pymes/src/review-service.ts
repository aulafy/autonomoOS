import type {TaskRuntimeState} from '@agent-world/task-runtime';
import type {EmailReviewStore} from './email-review-store.js';
import type {MailTaskStore} from './mail-task-store.js';
import {emailHash} from './email-provider.js';
import {normalizeSearch} from './search.js';
import {parseReviewQuery,REVIEW_STATES,type ReviewPage,type ReviewRow,type ReviewState,type ReviewQuery} from './review-contract.js';
export class ReviewCursorError extends Error {}
/** A read projection of durable facts. Opening a task performs the live checks;
 * the queue never grants approval, prepares a plan, or dispatches an effect. */
export class ReviewService {
 constructor(readonly tenant:string,private snapshot:()=>TaskRuntimeState,private reviews:EmailReviewStore,private bindings:MailTaskStore,private effects:()=>{taskId:string;effective:string;status:string}[],private delivery:'gmail'|'test'|'unconfigured',private contactName:(owner:string,id:string)=>string|null){}
 list(owner:string,raw:ReviewQuery):ReviewPage{
  const q=parseReviewQuery(raw),state=this.snapshot(),meta=new Map(this.reviews.queueSnapshot(owner).map(r=>[r.taskId,r]));
  const bindings=this.bindings.snapshotForOwner(owner),sources=new Map(bindings.map(b=>[b.taskId,b])),superseded=new Set(bindings.map(b=>b.revisesTaskId).filter(Boolean));
  const effects=new Map<string,{effective:string;status:string}[]>();for(const e of this.effects())if(state.tasks[e.taskId]?.owner===owner)effects.set(e.taskId,[...(effects.get(e.taskId)??[]),e]);
  const rows:ReviewRow[]=[],identities:unknown[]=[];
  for(const t of Object.values(state.tasks)){
   if(t.owner!==owner||superseded.has(t.id))continue;
   const m=meta.get(t.id),b=sources.get(t.id),e=effects.get(t.id)??[];
   let status:ReviewState;
   if(e.length)status=e.some(e=>e.effective==='unknown')?e.some(e=>['dispatching','prepared','preparing'].includes(e.status))?'running':'uncertain':e.every(e=>e.effective==='committed')?(t.status==='completed'?'completed':t.status==='failed'?'failed':t.status==='blocked'?'blocked':'running'):'failed';
   else if(t.status==='cancelled')status='cancelled';
   else if(t.status==='failed')status='failed';
   else if(m?.review&&m.review.planVersion!==t.planVersion)status='blocked';
   else if(m?.policy?.composition==='deny'||m?.policy?.flow==='deny')status='blocked';
   else if(m?.decision?.decision==='rejected')status='rejected';
   else if(t.status==='blocked'||t.status==='unknown')status='blocked';
   else if(m?.decision?.decision==='approved')status='ready';
   else if(m?.review)status='approval';
   else status=t.status==='completed'?'completed':['running','waiting','verifying'].includes(t.status)?'running':'draft';
   rows.push({taskId:t.id,title:t.goal,status,updatedAt:Math.max(t.updatedAt,m?.review?.at??0,m?.decision?.at??0,m?.draftAt??0),revision:b?.revision??1,origin:b?'gmail':'runtime',delivery:m?.review?m.review.provider==='gmail-email'?'gmail':'test':this.delivery,contactName:b?this.contactName(owner,b.contactId):null,priority:b?.priority??'normal',followUpDueAt:b?.followUpDueAt??null});
   identities.push({taskId:t.id,review:m?.review??null,decision:m?.decision??null,policy:m?.policy??null,draftHash:m?.draftHash??null,effects:e});
  }
  const rank:Record<ReviewState,number>={uncertain:0,failed:1,blocked:2,rejected:3,approval:4,ready:5,draft:6,running:7,completed:8,cancelled:9},priority={urgent:0,high:1,normal:2};
  rows.sort((a,b)=>rank[a.status]-rank[b.status]||priority[a.priority]-priority[b.priority]||b.updatedAt-a.updatedAt||a.taskId.localeCompare(b.taskId,'en'));
  identities.sort((a,b)=>String((a as {taskId:string}).taskId).localeCompare(String((b as {taskId:string}).taskId),'en'));
  const counts=Object.fromEntries(REVIEW_STATES.map(s=>[s,rows.filter(r=>r.status===s).length])) as Record<ReviewState,number>,snapshotHash=emailHash({rows,identities});
  const scopeHash=emailHash({tenant:this.tenant,owner,filter:q.filter,query:normalizeSearch(q.query),limit:q.limit,snapshotHash});
  const filtered=rows.filter(r=>(q.filter==='all'||(q.filter==='attention'?!['completed','cancelled'].includes(r.status):r.status===q.filter))&&normalizeSearch(r.title+' '+(r.contactName??'')).includes(normalizeSearch(q.query)));
  let start=0;
  if(q.cursor){
   try{const bytes=Buffer.from(q.cursor,'base64url');if(bytes.toString('base64url')!==q.cursor)throw new Error();const c=JSON.parse(bytes.toString('utf8'));if(!c||Object.keys(c).sort().join(',')!=='lastTaskId,scopeHash,v'||c.v!==1||c.scopeHash!==scopeHash)throw new Error();const index=filtered.findIndex(r=>r.taskId===c.lastTaskId);if(index<0)throw new Error();start=index+1;}catch{throw new ReviewCursorError('REVIEW_CURSOR_STALE');}
  }
  const items=filtered.slice(start,start+q.limit),nextCursor=start+items.length<filtered.length?Buffer.from(JSON.stringify({v:1,scopeHash,lastTaskId:items.at(-1)!.taskId})).toString('base64url'):null;
  return {tenantId:this.tenant,filter:q.filter,query:q.query,items,counts,total:rows.length,matchedTotal:filtered.length,nextCursor,snapshotHash};
 }
}
