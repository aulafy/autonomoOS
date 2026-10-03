import type { Observation } from '@agent-world/observation';
import { postconditionHash } from '@agent-world/observation';
import type { JsonValue } from '@agent-world/task-runtime';
import type { VerificationInput } from './types.js';
/** Use only as a host decoder behind GovernedVerificationCollector, which checks
 * effect, intent, observer identity and independence. Executes no filesystem read. */
export function decodeFilesystemVerification(observation:Observation,input:VerificationInput):JsonValue {
 const criterion=input.criterion;
 if(criterion.kind!=='file' || observation.source!=='filesystem' ||
    !['confirmed','contradicted'].includes(observation.status) ||
    observation.subject.taskId!==input.taskId || observation.subject.resourceIds.length!==1 ||
    observation.subject.resourceIds[0]!==criterion.resource ||
    !['filesystem_read','filesystem_write'].includes(observation.expectedPostcondition.kind) ||
    observation.expectedPostcondition.resourceIds.length!==1 || observation.expectedPostcondition.resourceIds[0]!==criterion.resource ||
    postconditionHash(observation.expectedPostcondition)!==observation.expectedPostconditionHash) throw new Error('FILESYSTEM_VERIFICATION_UNBOUND');
 const hashes=observation.evidence.filter(e=>e.kind==='hash');
 const absent=observation.evidence.filter(e=>e.kind==='resource' && e.reference===`${criterion.resource}:absent` && e.metadata.absent===true);
 if(absent.length===1 && hashes.length===0 && observation.status==='contradicted') return {resource:criterion.resource,exists:false};
 if(absent.length || hashes.length!==1) throw new Error('FILESYSTEM_EVIDENCE_AMBIGUOUS');
 const evidence=hashes[0]!,digest=evidence.metadata.sha256,length=evidence.metadata.byteLength;
 if(typeof digest!=='string' || !/^[a-f0-9]{64}$/.test(digest) || evidence.reference!==`${criterion.resource}:${digest}` || typeof length!=='number' || !Number.isSafeInteger(length) || length<0) throw new Error('FILESYSTEM_DIGEST_INVALID');
 return {resource:criterion.resource,exists:true,digest:`sha256:${digest}`,byteLength:length};
}
