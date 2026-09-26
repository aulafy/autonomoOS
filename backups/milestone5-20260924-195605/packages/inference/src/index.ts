import { z } from "zod";

export type InferenceCapability =
  | "text"
  | "structured_output"
  | "tools"
  | "vision";

export interface InferenceProviderHealth {
  ok: boolean;
  provider: string;
  endpoint: string;
  detail?: string;
}

export interface PlanContext {
  agentId: string;
  userGoal: string;
  availableActions: string[];
  entities: Array<{
    id: string;
    kind: string;
    name: string;
    affordances: string[];
  }>;
}

export const ProposedActionSchema = z.object({
  action: z.enum([
    "say",
    "goto",
    "look_at",
    "pick",
    "drop",
    "use",
    "use_tool",
    "delegate",
    "ask_human"
  ]),
  targetId: z.string().optional(),
  parameters: z.record(z.unknown()).optional()
});

export const ProposedPlanSchema = z.object({
  actions: z.array(ProposedActionSchema).min(1).max(12)
});

export type ProposedPlan = z.infer<typeof ProposedPlanSchema>;

export interface InferenceProvider {
  readonly id: string;

  capabilities(): Promise<InferenceCapability[]>;

  health(): Promise<InferenceProviderHealth>;

  proposePlan(context: PlanContext): Promise<{
    plan: ProposedPlan;
    rawText: string;
    model?: string;
    latencyMs: number;
  }>;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    return JSON.parse(fence[1].trim());
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");

  if (first >= 0 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }

  throw new Error("Model did not return parseable JSON");
}

export class LlamaCppProvider implements InferenceProvider {
  readonly id = "llama.cpp";

  constructor(
    private baseUrl = process.env.LLAMA_BASE_URL ?? "http://127.0.0.1:8080"
  ) {}

  async capabilities(): Promise<InferenceCapability[]> {
    return ["text", "structured_output"];
  }

  async health(): Promise<InferenceProviderHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`);

      if (!response.ok) {
        return {
          ok: false,
          provider: this.id,
          endpoint: this.baseUrl,
          detail: `HTTP ${response.status}`
        };
      }

      return {
        ok: true,
        provider: this.id,
        endpoint: this.baseUrl
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.id,
        endpoint: this.baseUrl,
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async proposePlan(context: PlanContext) {
    const started = performance.now();

    const system = [
      "You are the planning component of Agent World OS.",
      "You do not execute actions.",
      "You only propose a short structured plan.",
      "Return valid JSON and nothing else.",
      "",
      'Schema:',
      '{"actions":[{"action":"goto|say|look_at|pick|drop|use|use_tool|delegate|ask_human","targetId":"optional entity id","parameters":{}}]}',
      "",
      "Rules:",
      "- Only use actions listed in availableActions.",
      "- Only reference entity IDs present in entities.",
      "- Prefer the minimum number of actions.",
      "- Do not invent tools, entities, permissions or results.",
      "- A proposal is not an execution.",
      "- If the goal cannot be completed with available actions, use ask_human."
    ].join("\n");

    const user = JSON.stringify({
      goal: context.userGoal,
      agentId: context.agentId,
      availableActions: context.availableActions,
      entities: context.entities
    });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "local-model",
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `llama.cpp request failed: HTTP ${response.status} ${body}`
      );
    }

    const json = await response.json() as any;
    const rawText =
      json?.choices?.[0]?.message?.content ??
      "";

    const parsed = ProposedPlanSchema.parse(extractJson(rawText));

    return {
      plan: parsed,
      rawText,
      model: json?.model,
      latencyMs: Math.round(performance.now() - started)
    };
  }
}
