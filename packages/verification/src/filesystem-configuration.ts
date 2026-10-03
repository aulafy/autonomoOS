import {recordDigest,recordId} from '@agent-world/decision-ledger';
import {isCanonicalResourceId} from '@agent-world/resources';
import type {GovernedActionRequest} from '@agent-world/control-plane';
import {GovernedVerificationCollector,type GovernedCollectorOptions} from './collector.js';
import {decodeFilesystemVerification} from './filesystem-decoder.js';
import {DeterministicVerifier} from './verifiers.js';
export interface FilesystemVerificationBinding {
 taskId:string;workUnitId:string;attemptId:string;resourceId:string;
 principalId:string;contractId:string;authorityLeaseId:string;
 resourceLeaseId?:string;fencingToken?:number;
}
/** Host configuration only. Binding is descriptive; C12 revalidates live authority,
 * contract, resource, budget and optional resource lease before any real read. */
export function createFilesystemVerifier(options:Pick<GovernedCollectorOptions,'runner'|'observations'|'observers'|'store'> & {
 bindings:FilesystemVerificationBinding[];now:()=>number;
}):DeterministicVerifier {
 const bindings=structuredClone(options.bindings);
 const keys=new Set<string>();
 for(const b of bindings) {
  const key=recordDigest({taskId:b.taskId,workUnitId:b.workUnitId,attemptId:b.attemptId,resourceId:b.resourceId});
  if(![b.taskId,b.workUnitId,b.attemptId,b.principalId,b.contractId,b.authorityLeaseId].every(recordId) || !isCanonicalResourceId(b.resourceId) || !b.resourceId.startsWith('file:') || keys.has(key) || (b.resourceLeaseId!==undefined && !recordId(b.resourceLeaseId)) || (b.fencingToken!==undefined && (!Number.isSafeInteger(b.fencingToken)||b.fencingToken<0))) throw new Error('INVALID_FILESYSTEM_VERIFICATION_BINDING');
  keys.add(key);
 }
 const collector=new GovernedVerificationCollector({...options,observerIds:['filesystem-observer'],decode:decodeFilesystemVerification,
  plan:async(input,key):Promise<GovernedActionRequest>=>{
   const c=input.criterion;
   if(c.kind!=='file' || !c.assertion || typeof c.assertion!=='object' || Array.isArray(c.assertion)) throw new Error('FILE_ASSERTION_UNSUPPORTED');
   const assertion=c.assertion as Record<string,unknown>,fields=Object.keys(assertion);
   if(!fields.length || fields.some(f=>!['exists','digest'].includes(f)) || ('exists' in assertion && typeof assertion.exists!=='boolean') || ('digest' in assertion && (typeof assertion.digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(assertion.digest)))) throw new Error('FILE_ASSERTION_UNSUPPORTED');
   const b=bindings.find(b=>b.taskId===input.taskId && b.workUnitId===input.workUnitId && b.attemptId===input.attemptId && b.resourceId===c.resource);
   if(!b) throw new Error('FILE_VERIFICATION_NOT_CONFIGURED');
   return {taskId:b.taskId,principalId:b.principalId,contractId:b.contractId,authorityLeaseId:b.authorityLeaseId,
    ...(b.resourceLeaseId===undefined?{}:{resourceLeaseId:b.resourceLeaseId}),...(b.fencingToken===undefined?{}:{fencingToken:b.fencingToken}),correlationId:key,
    intent:{id:`verify-file-${key.slice(11)}`,actorId:b.principalId,action:'file.read',targetId:b.resourceId,parameters:{verificationCriterionDigest:recordDigest(c)},provenance:{source:'rule'}}};
  }});
 return new DeterministicVerifier('file',collector,options.now);
}
