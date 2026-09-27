import type { ActionIntent } from "@agent-world/protocol";

export type PolicyDecision = {
  allowed: boolean;
  risk: "R0" | "R1" | "R2" | "R3" | "R4" | "R5";
  reason: string;
};

export function authorize(intent: ActionIntent): PolicyDecision {
  const riskByAction: Record<ActionIntent["action"], PolicyDecision["risk"]> = {
    say: "R0",
    look_at: "R0",
    goto: "R1",
    pick: "R1",
    drop: "R1",
    use: "R1",
    use_tool: "R2",
    delegate: "R2",
    ask_human: "R0",
    purchase_compute: "R4",
    "file.read": "R1", "file.write": "R2"
  };

  const risk = riskByAction[intent.action];

  if (risk === "R4" || risk === "R5") {
    return {
      allowed: false,
      risk,
      reason: "High-risk actions are disabled in v0.1"
    };
  }

  return {
    allowed: true,
    risk,
    reason: "Allowed by v0.1 policy"
  };
}
