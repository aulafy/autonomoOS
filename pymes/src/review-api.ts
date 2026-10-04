import type {WorkspaceApiRequest,WorkspaceApiResponse,WorkspaceRepository,WorkspaceRuntimeSource} from './workspace-api.js';
import {requirePermission} from './workspace-policy.js';
import {parseReviewQuery} from './review-contract.js';
import {ReviewCursorError} from './review-service.js';
export function handleReviewQueue(request:WorkspaceApiRequest,parts:string[],repo:WorkspaceRepository,runtime?:WorkspaceRuntimeSource):WorkspaceApiResponse{
 const token=request.authorization?.startsWith('Bearer ')?request.authorization.slice(7).trim():null,p=token?repo.findSession(token):null;
 if(!p)return {status:401,body:{error:'UNAUTHENTICATED'}};
 const tenant=parts[2]!;try{requirePermission(p,'readRuntime',{tenantId:tenant,id:tenant});}catch{return {status:403,body:{error:'PERMISSION_DENIED'}};}
 if(request.method!=='GET'||parts.length!==4)return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};
 if(!runtime?.reviews||runtime.reviews.tenant!==tenant)return {status:404,body:{error:'REVIEW_NOT_CONFIGURED'}};
 let q;try{const params=new URLSearchParams(request.path.split('?')[1]??'');if([...params.keys()].some(k=>!['filter','query','limit','cursor'].includes(k))||[...new Set(params.keys())].some(k=>params.getAll(k).length!==1))throw new Error();q=parseReviewQuery({filter:params.get('filter')??'attention',query:params.get('query')??'',limit:params.has('limit')?Number(params.get('limit')):25,cursor:params.get('cursor')});}catch{return {status:400,body:{error:'REVIEW_QUERY_INVALID'}};}
 try{return {status:200,body:runtime.reviews.list(runtime.principalIdForSession(p),q) as unknown as Record<string,unknown>};}catch(e){return {status:e instanceof ReviewCursorError?409:503,body:{error:e instanceof ReviewCursorError?'REVIEW_CURSOR_STALE':'REVIEW_NOT_AVAILABLE'}};}
}
