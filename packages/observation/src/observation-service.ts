import { randomUUID } from "node:crypto";
import { isCanonicalResourceId } from "@agent-world/resources";
import type { ContractRisk } from "@agent-world/contracts";
import type { Clock } from "./clock.js";
import { ObservationError } from "./errors.js";
import { postconditionHash } from "./expected-postcondition.js";
import type { Observation } from "./observation.js";
import type { ObservationEvaluation } from "./observation-evaluation.js";
import type { ObservationRequest, Observer } from "./observer.js";
import type { ObserverRegistry } from "./observer-registry.js";
import type { ObservationStore } from "./observation-store.js";
import { ObservationPolicy } from "./observation-policy.js";
import { sameSubject } from "./observation-subject.js";

export interface ObservationServiceInput {
  observerId: string;
  request: ObservationRequest;
  riskClass: ContractRisk;
  maxAgeMs: number;
  requireGenerationBinding?: boolean;
  timeoutMs?: number;
}
export interface ObservationServiceResult {
  observation: Observation;
  evaluation: ObservationEvaluation;
}
export interface IdGenerator { next(): string }
export const uuidGenerator: IdGenerator = { next: () => randomUUID() };

const statuses = new Set(["confirmed", "contradicted", "unknown", "inconclusive", "stale"]);
const evidenceKinds = new Set(["resource", "provider_receipt", "sensor", "hash", "event", "human", "custom"]);

export class ObservationService {
  constructor(
    private readonly observers: ObserverRegistry,
    private readonly store: ObservationStore,
    private readonly policy: ObservationPolicy,
    private readonly clock: Clock,
    private readonly ids: IdGenerator = uuidGenerator
  ) {}

  async observe(input: ObservationServiceInput, signal: AbortSignal = new AbortController().signal):
    Promise<ObservationServiceResult> {
    this.validateRequest(input.request);
    if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
      throw new ObservationError("INVALID_OBSERVER_RESULT", "invalid_timeout");
    }
    const observer = this.observers.get(input.observerId);
    if (!observer) throw new ObservationError("OBSERVER_NOT_FOUND", input.observerId);
    let raw: Observation;
    try {
      raw = await this.invoke(observer, input.request, signal, input.timeoutMs);
    } catch {
      raw = {
        id: this.ids.next(), subject: structuredClone(input.request.subject),
        observerId: observer.descriptor.id, source: observer.descriptor.sourceType,
        status: "unknown", observedAt: this.clock.now(),
        expectedPostcondition: structuredClone(input.request.expectedPostcondition),
        expectedPostconditionHash: postconditionHash(input.request.expectedPostcondition),
        observedResourceGenerations: {}, evidence: [], reason: "OBSERVER_ERROR", metadata: {}
      };
    }
    this.validateResult(raw, observer, input.request);
    const observation = this.store.append(raw);
    const evaluation = this.policy.evaluate(observation, observer.descriptor, {
      subject: input.request.subject, expectedPostcondition: input.request.expectedPostcondition,
      riskClass: input.riskClass, maxAgeMs: input.maxAgeMs,
      requireGenerationBinding: input.requireGenerationBinding
    });
    return { observation, evaluation };
  }

  private validateRequest(request: ObservationRequest): void {
    const ids = request.subject?.resourceIds;
    if (!request.subject?.taskId || !Array.isArray(ids) ||
      ids.some(id => !isCanonicalResourceId(id)) || new Set(ids).size !== ids.length ||
      !Array.isArray(request.context?.resourceIds) ||
      !sameIds(ids, request.context.resourceIds) ||
      !request.expectedPostcondition?.kind ||
      !Array.isArray(request.expectedPostcondition.resourceIds) ||
      request.expectedPostcondition.resourceIds.some(id => !ids.includes(id))) {
      throw new ObservationError("INVALID_OBSERVER_RESULT", "invalid_request");
    }
    try { postconditionHash(request.expectedPostcondition); }
    catch { throw new ObservationError("INVALID_OBSERVER_RESULT", "invalid_postcondition"); }
  }

  private validateResult(raw: Observation, observer: Observer, request: ObservationRequest): void {
    if (!raw || typeof raw !== "object" || !raw.id ||
      raw.observerId !== observer.descriptor.id || raw.source !== observer.descriptor.sourceType ||
      !statuses.has(raw.status) || !Number.isFinite(raw.observedAt) ||
      raw.observedAt < 0 || raw.observedAt > this.clock.now() || !raw.reason ||
      !Array.isArray(raw.evidence) || !raw.metadata || typeof raw.metadata !== "object" ||
      !raw.observedResourceGenerations || typeof raw.observedResourceGenerations !== "object") {
      throw new ObservationError("INVALID_OBSERVER_RESULT");
    }
    if (!sameSubject(raw.subject, request.subject)) {
      throw new ObservationError("OBSERVATION_SUBJECT_MISMATCH");
    }
    const expectedHash = postconditionHash(request.expectedPostcondition);
    let actualHash: string;
    try { actualHash = postconditionHash(raw.expectedPostcondition); }
    catch { throw new ObservationError("INVALID_OBSERVER_RESULT", "invalid_postcondition"); }
    if (raw.expectedPostconditionHash !== expectedHash || actualHash !== expectedHash) {
      throw new ObservationError("POSTCONDITION_MISMATCH");
    }
    if ((raw.status === "confirmed" || raw.status === "contradicted") && raw.evidence.length === 0) {
      throw new ObservationError("INVALID_OBSERVER_RESULT", "missing_evidence");
    }
    for (const evidence of raw.evidence) {
      if (!evidence || !evidenceKinds.has(evidence.kind) || !evidence.reference ||
        !evidence.metadata || typeof evidence.metadata !== "object") {
        throw new ObservationError("INVALID_OBSERVER_RESULT", "invalid_evidence");
      }
    }
    for (const [id, generation] of Object.entries(raw.observedResourceGenerations)) {
      if (!raw.subject.resourceIds.includes(id as typeof raw.subject.resourceIds[number]) ||
        !Number.isInteger(generation) || generation < 1) {
        throw new ObservationError("INVALID_OBSERVER_RESULT", "invalid_generation");
      }
    }
  }

  private async invoke(observer: Observer, request: ObservationRequest, signal: AbortSignal,
    timeoutMs?: number): Promise<Observation> {
    if (signal.aborted) throw new Error("observer_aborted");
    if (timeoutMs === undefined) return observer.observe(request, signal);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new ObservationError("INVALID_OBSERVER_RESULT", "invalid_timeout");
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("observer_timeout"));
        }, timeoutMs);
      });
      return await Promise.race([observer.observe(request, controller.signal), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.length === rightSorted.length &&
    leftSorted.every((id, index) => id === rightSorted[index]);
}
