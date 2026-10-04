import {crmId,crmRecord,crmText} from './crm-contract.js';
export const REVIEW_STATES=['draft','approval','ready','rejected','blocked','uncertain','running','failed','completed','cancelled'] as const;
export type ReviewState=typeof REVIEW_STATES[number];
export type ReviewFilter=ReviewState|'attention'|'all';
export interface ReviewQuery {filter:ReviewFilter;query:string;limit:number;cursor:string|null;}
export interface ReviewRow {
 taskId:string;title:string;status:ReviewState;updatedAt:number;revision:number;
 origin:'gmail'|'runtime';delivery:'gmail'|'test'|'unconfigured';contactName:string|null;
 priority:'normal'|'high'|'urgent';followUpDueAt:number|null;
}
export interface ReviewPage {tenantId:string;filter:ReviewFilter;query:string;items:ReviewRow[];counts:Record<ReviewState,number>;total:number;matchedTotal:number;nextCursor:string|null;snapshotHash:string;}
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function parseReviewQuery(raw:unknown):ReviewQuery{
 const r=crmRecord(raw);if(Object.keys(r).some(k=>!['filter','query','limit','cursor'].includes(k)))throw new Error('REVIEW_QUERY_INVALID');
 const filter=r.filter??'attention',query=r.query??'',limit=r.limit??25,cursor=r.cursor??null;
 if(typeof filter!=='string'||![...REVIEW_STATES,'attention','all'].includes(filter)||typeof query!=='string'||query.length>100||/[\u0000-\u001f\u007f]/.test(query)||!integer(limit)||Number(limit)<1||Number(limit)>50||cursor!==null&&(typeof cursor!=='string'||cursor.length>1024||!/^[-a-zA-Z0-9_]+$/.test(cursor)))throw new Error('REVIEW_QUERY_INVALID');
 return {filter:filter as ReviewFilter,query:query.trim(),limit:Number(limit),cursor:cursor as string|null};
}
export function parseReviewPage(raw:unknown,tenant:string,request:ReviewQuery):ReviewPage{
 const r=crmRecord(raw),bad=()=>{throw new Error('REVIEW_RESPONSE_INVALID');};
 if(Object.keys(r).sort().join(',')!=='counts,filter,items,matchedTotal,nextCursor,query,snapshotHash,tenantId,total'||r.tenantId!==tenant||r.filter!==request.filter||r.query!==request.query||!integer(r.total)||!integer(r.matchedTotal)||Number(r.matchedTotal)>Number(r.total)||typeof r.snapshotHash!=='string'||!/^[a-f0-9]{64}$/.test(r.snapshotHash)||r.nextCursor!==null&&(typeof r.nextCursor!=='string'||r.nextCursor.length>1024||!/^[-a-zA-Z0-9_]+$/.test(r.nextCursor))||!Array.isArray(r.items)||r.items.length>request.limit)return bad();
 const c=crmRecord(r.counts);if(Object.keys(c).sort().join(',')!==[...REVIEW_STATES].sort().join(',')||Object.values(c).some(v=>!integer(v))||Object.values(c).reduce<number>((s,v)=>s+Number(v),0)!==r.total)return bad();
 const ids=new Set<string>();const items=r.items.map(raw=>{
  const a=crmRecord(raw);if(Object.keys(a).sort().join(',')!=='contactName,delivery,followUpDueAt,origin,priority,revision,status,taskId,title,updatedAt'||!REVIEW_STATES.includes(a.status as ReviewState)||!integer(a.updatedAt)||!integer(a.revision)||Number(a.revision)<1||Number(a.revision)>100||!['gmail','runtime'].includes(String(a.origin))||!['gmail','test','unconfigured'].includes(String(a.delivery))||!['normal','high','urgent'].includes(String(a.priority))||a.followUpDueAt!==null&&!integer(a.followUpDueAt))return bad();
  if(request.filter!=='all'&&(request.filter==='attention'?['completed','cancelled'].includes(String(a.status)):a.status!==request.filter))return bad();
  const taskId=crmId(a.taskId);if(ids.has(taskId))return bad();ids.add(taskId);
  return {taskId,title:crmText(a.title,2000),status:a.status as ReviewState,updatedAt:Number(a.updatedAt),revision:Number(a.revision),origin:a.origin,delivery:a.delivery,contactName:a.contactName===null?null:crmText(a.contactName,200),priority:a.priority,followUpDueAt:a.followUpDueAt} as ReviewRow;
 });
 if(items.length>Number(r.matchedTotal)||r.nextCursor&&items.length!==request.limit)return bad();
 return {tenantId:tenant,filter:request.filter,query:request.query,items,counts:c as Record<ReviewState,number>,total:Number(r.total),matchedTotal:Number(r.matchedTotal),nextCursor:r.nextCursor as string|null,snapshotHash:r.snapshotHash};
}
