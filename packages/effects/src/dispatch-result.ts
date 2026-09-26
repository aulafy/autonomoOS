export type FailureCertainty = "certified_not_started" | "may_have_started";
export type DispatchResult =
  | { kind: "reported_success"; externalReference?: string; metadata: Record<string, unknown> }
  | { kind: "reported_failure"; certainty: FailureCertainty; reason: string;
      metadata: Record<string, unknown> }
  | { kind: "unknown"; reason: string; externalReference?: string;
      metadata: Record<string, unknown> };
