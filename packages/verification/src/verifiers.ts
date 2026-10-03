import type { JsonValue,SuccessCriterion } from "@agent-world/task-runtime";
import { canonicalRecord,recordDigest,recordId } from "@agent-world/decision-ledger";
import type { VerificationCollector,VerificationInput,Verifier,CriterionResult } from "./types.js";
import { evaluateSchema } from "./schema.js";
const object=(value:unknown):Record<string,JsonValue> => {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("MALFORMED_OBSERVATION_PAYLOAD");
  return value as Record<string,JsonValue>;
};
function predicate(raw:JsonValue,payload:JsonValue):boolean {
  const rule=object(raw);
  if (Object.keys(rule).some(key => !["path","equals"].includes(key)) || !Array.isArray(rule.path) || !Object.hasOwn(rule,"equals") || rule.path.some(key => typeof key!=="string" || ["__proto__","constructor","prototype"].includes(key))) throw new Error("UNSUPPORTED_PREDICATE");
  let value:JsonValue=payload;
  for (const key of rule.path as string[]) {
    if (!value || typeof value!=="object" || !Object.hasOwn(value,key)) return false;
    value=(value as Record<string,JsonValue>)[key]!;
  }
  return canonicalRecord(value)===canonicalRecord(rule.equals);
}
export class DeterministicVerifier implements Verifier {
  readonly id:string;
  constructor(private kind:Exclude<SuccessCriterion["kind"],"custom">,private collector:VerificationCollector,private now:() => number) { this.id=`verify:${kind}`; }
  supports(criterion:SuccessCriterion):boolean { return criterion.kind===this.kind; }
  async verify(input:VerificationInput,signal=new AbortController().signal):Promise<CriterionResult> {
    let observationRefs:string[]=[],observedAt:number|undefined;
    const unknown=(reason:string):CriterionResult => ({ criterionId:input.criterion.id,verifierId:this.id,status:"unknown",reason,observationRefs:[...observationRefs],...(observedAt===undefined ? {} : {observedAt}) });
    if (!this.supports(input.criterion) || ![input.taskId,input.workUnitId,input.attemptId,input.criterion.id].every(recordId) || !Number.isFinite(input.maxAgeMs) || input.maxAgeMs<0 || signal.aborted) return unknown("invalid_verification_input");
    try {
      const inputCopy=structuredClone(input),packet=await this.collector.collect(inputCopy,signal);
      if (packet.status!=="observed") return unknown("collection_unknown");
      canonicalRecord(packet.payload);
      const now=this.now();
      if (signal.aborted || packet.taskId!==input.taskId || packet.workUnitId!==input.workUnitId || packet.attemptId!==input.attemptId || packet.criterionDigest!==recordDigest(input.criterion) || !Number.isFinite(packet.observedAt) || packet.observedAt>now || now-packet.observedAt>input.maxAgeMs || !Array.isArray(packet.observationRefs) || !packet.observationRefs.length || !packet.observationRefs.every(recordId) || new Set(packet.observationRefs).size!==packet.observationRefs.length) return unknown("observation_scope_or_freshness_mismatch");
      observationRefs=[...packet.observationRefs]; observedAt=packet.observedAt;
      const criterion=input.criterion,payload=object(packet.payload); let satisfied:boolean|undefined;
      switch(criterion.kind) {
        case "test":
          if (payload.command!==criterion.command || payload.cwdResource!==criterion.cwdResource || !Number.isInteger(payload.exitCode)) return unknown("test_observation_unbound");
          satisfied=payload.exitCode===criterion.expectedExitCode; break;
        case "file": {
          if (payload.resource!==criterion.resource || typeof payload.exists!=="boolean") return unknown("file_observation_unbound");
          const assertion=object(criterion.assertion),keys=Object.keys(assertion);
          if (!keys.length || keys.some(key => !["exists","contains","digest"].includes(key))) return unknown("unsupported_file_assertion");
          const results:boolean[]=[];
          if (Object.hasOwn(assertion,"exists")) { if (typeof assertion.exists!=="boolean") return unknown("invalid_file_assertion"); results.push(payload.exists===assertion.exists); }
          if (Object.hasOwn(assertion,"contains")) { if (typeof assertion.contains!=="string") return unknown("invalid_file_assertion"); if (payload.exists && typeof payload.content!=="string") return unknown("file_content_unobserved"); results.push(payload.exists && (payload.content as string).includes(assertion.contains)); }
          if (Object.hasOwn(assertion,"digest")) { if (typeof assertion.digest!=="string" || !/^sha256:[a-f0-9]{64}$/.test(assertion.digest)) return unknown("invalid_file_assertion"); if (payload.exists && typeof payload.digest!=="string") return unknown("file_digest_unobserved"); results.push(payload.exists && payload.digest===assertion.digest); }
          satisfied=results.every(Boolean); break;
        }
        case "schema":
          if (payload.artifactRef!==criterion.artifactRef || !Object.hasOwn(payload,"value")) return unknown("schema_artifact_unbound");
          satisfied=await evaluateSchema(criterion.schema,payload.value!,signal); break;
        case "http":
          if (payload.urlResource!==criterion.request.urlResource || payload.method!==criterion.request.method || typeof payload.status!=="number" || !Number.isInteger(payload.status) || payload.status<100 || payload.status>599) return unknown("http_observation_unbound");
          if (criterion.expectedStatus===undefined && criterion.bodyAssertion===undefined) return unknown("http_assertion_required");
          satisfied=criterion.expectedStatus===undefined || payload.status===criterion.expectedStatus;
          if (criterion.bodyAssertion!==undefined) {
            const assertion=object(criterion.bodyAssertion);
            if (Object.keys(assertion).length!==1 || typeof assertion.contains!=="string") return unknown("unsupported_http_body_assertion");
            if (typeof payload.body!=="string") return unknown("http_body_unobserved");
            satisfied=satisfied && payload.body.includes(assertion.contains);
          }
          break;
        case "observation": satisfied=predicate(criterion.predicate,packet.payload); break;
        case "human-approval":
          if (payload.principalId!==criterion.approver || payload.taskId!==input.taskId || payload.workUnitId!==input.workUnitId || payload.attemptId!==input.attemptId || typeof payload.approved!=="boolean" || !recordId(payload.approvalId) || typeof payload.expiresAt!=="number" || payload.expiresAt<=now) return unknown("human_approval_unbound_or_expired");
          satisfied=payload.approved; break;
        default: return unknown("unsupported_criterion");
      }
      if (satisfied===undefined || signal.aborted) return unknown("evaluation_unverifiable");
      return { criterionId:criterion.id,verifierId:this.id,status:satisfied ? "satisfied" : "unsatisfied",reason:satisfied ? "criterion_satisfied" : "criterion_contradicted",observationRefs:[...packet.observationRefs],observedAt:packet.observedAt };
    } catch { return unknown("verification_error"); }
  }
}
export function initialVerifiers(collector:VerificationCollector,now:() => number):Verifier[] {
  return (["test","file","schema","http","observation","human-approval"] as const).map(kind => new DeterministicVerifier(kind,collector,now));
}
