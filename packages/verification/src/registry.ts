import { recordId } from "@agent-world/decision-ledger";
import type { Verifier,VerificationInput,CriterionResult } from "./types.js";
export class VerifierRegistry {
  private verifiers=new Map<string,Verifier>();
  constructor(private readonly timeoutMs=30000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs<=0 || timeoutMs>60000) throw new Error("INVALID_VERIFIER_TIMEOUT");
  }
  register(verifier:Verifier):void {
    if (!recordId(verifier.id) || this.verifiers.has(verifier.id) || typeof verifier.supports!=="function" || typeof verifier.verify!=="function") throw new Error("INVALID_VERIFIER_REGISTRATION");
    this.verifiers.set(verifier.id,verifier);
  }
  async verify(input:VerificationInput,signal?:AbortSignal):Promise<CriterionResult> {
    const unknown=(reason:string):CriterionResult => ({ criterionId:input.criterion.id,verifierId:"registry",status:"unknown",reason,observationRefs:[] });
    if (signal?.aborted) return unknown("verification_aborted");
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    let onAbort:()=>void=()=>{};
    try {
      const matches=[...this.verifiers.values()].filter(verifier => verifier.supports(input.criterion) && (input.criterion.kind!=="custom" || verifier.id===input.criterion.verifierId));
      if (matches.length!==1) return unknown(matches.length ? "ambiguous_verifier" : "verifier_unavailable");
      const stop=new Promise<never>((_,reject)=>{
        onAbort=()=>{controller.abort();reject(new Error("verification_aborted"));};
        signal?.addEventListener("abort",onAbort,{once:true});
        timer=setTimeout(()=>{controller.abort();reject(new Error("verification_timeout"));},this.timeoutMs);
      });
      const result=await Promise.race([matches[0]!.verify(structuredClone(input),controller.signal),stop]);
      if (signal?.aborted) return unknown("verification_aborted");
      if (result.criterionId!==input.criterion.id || result.verifierId!==matches[0]!.id || !["satisfied","unsatisfied","unknown"].includes(result.status) || typeof result.reason!=="string" || !result.reason.trim() || result.reason.length>30000 || !Array.isArray(result.observationRefs) || !result.observationRefs.every(recordId) || new Set(result.observationRefs).size!==result.observationRefs.length || result.status!=="unknown" && (!result.observationRefs.length || !Number.isFinite(result.observedAt))) return unknown("malformed_verifier_result");
      return structuredClone(result);
    } catch (error) { return unknown(error instanceof Error && ["verification_aborted","verification_timeout"].includes(error.message) ? error.message : "verifier_error"); }
    finally { if(timer!==undefined) clearTimeout(timer);signal?.removeEventListener("abort",onAbort); }
  }
}
