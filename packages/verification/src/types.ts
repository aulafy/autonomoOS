import type { JsonValue,SuccessCriterion } from "@agent-world/task-runtime";
export interface VerificationInput {
  taskId:string; workUnitId:string; attemptId:string; criterion:SuccessCriterion;
  maxAgeMs:number;
}
export type CollectedVerification =
  | { status:"observed"; taskId:string; workUnitId:string; attemptId:string; criterionDigest:string; observationRefs:string[]; observedAt:number; payload:JsonValue }
  | { status:"unknown"; reason:string };
/** Trusted host port. Production implementation must use governed observation. */
export interface VerificationCollector { collect(input:VerificationInput,signal:AbortSignal):Promise<CollectedVerification> }
export interface CriterionResult {
  criterionId:string; verifierId:string; status:"satisfied"|"unsatisfied"|"unknown";
  reason:string; observationRefs:string[]; observedAt?:number;
}
export interface Verifier { readonly id:string; supports(criterion:SuccessCriterion):boolean; verify(input:VerificationInput,signal?:AbortSignal):Promise<CriterionResult> }
