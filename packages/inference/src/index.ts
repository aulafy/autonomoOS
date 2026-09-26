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

  model?: string;
  latencyMs?: number;

  authConfigured: boolean;
  authRequired?: boolean;

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
    "ask_human",
    "purchase_compute"
  ]),

  targetId: z.string().optional(),

  parameters: z.record(z.unknown()).optional()
});

export const ProposedPlanSchema = z.object({
  actions: z.array(ProposedActionSchema).min(1).max(12)
});

export type ProposedAction = z.infer<typeof ProposedActionSchema>;
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

  if (fence?.[1]) {
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

  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options?: {
    baseUrl?: string;
    apiKey?: string;
  }) {
    this.baseUrl =
      options?.baseUrl ??
      process.env.LLAMA_BASE_URL ??
      "http://127.0.0.1:8080";

    this.apiKey =
      options?.apiKey ??
      process.env.LLAMA_API_KEY ??
      undefined;
  }

  async capabilities(): Promise<InferenceCapability[]> {
    return ["text", "structured_output"];
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private async fetchModels(): Promise<{
    ok: boolean;
    status: number;
    body: any;
    latencyMs: number;
  }> {
    const started = performance.now();

    const response = await fetch(
      `${this.baseUrl}/v1/models`,
      {
        headers: this.headers()
      }
    );

    let body: any = null;

    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
      latencyMs: Math.round(performance.now() - started)
    };
  }

  private async resolveModelId(): Promise<string> {
    const result = await this.fetchModels();

    if (!result.ok) {
      if (result.status === 401) {
        throw new Error(
          "llama.cpp requires authentication. " +
          "Set LLAMA_API_KEY for the Agent Runtime, or start llama-server without an API key."
        );
      }

      throw new Error(
        `Could not query llama.cpp models: HTTP ${result.status}`
      );
    }

    const id =
      result.body?.data?.[0]?.id ??
      result.body?.models?.[0]?.id;

    if (typeof id === "string" && id.length > 0) {
      return id;
    }

    // llama.cpp generally ignores the OpenAI model field when only one model is loaded,
    // but keep a stable fallback for compatibility.
    return process.env.LLAMA_MODEL ?? "local-model";
  }

  async health(): Promise<InferenceProviderHealth> {
    try {
      const result = await this.fetchModels();

      if (!result.ok) {
        return {
          ok: false,
          provider: this.id,
          endpoint: this.baseUrl,
          latencyMs: result.latencyMs,
          authConfigured: Boolean(this.apiKey),
          authRequired: result.status === 401,
          detail:
            result.status === 401
              ? "HTTP 401: llama.cpp requires an API key."
              : `HTTP ${result.status}`
        };
      }

      const model =
        result.body?.data?.[0]?.id ??
        result.body?.models?.[0]?.id;

      return {
        ok: true,
        provider: this.id,
        endpoint: this.baseUrl,
        model:
          typeof model === "string"
            ? model
            : undefined,
        latencyMs: result.latencyMs,
        authConfigured: Boolean(this.apiKey),
        authRequired: false
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.id,
        endpoint: this.baseUrl,
        authConfigured: Boolean(this.apiKey),
        detail:
          error instanceof Error
            ? error.message
            : String(error)
      };
    }
  }

  async proposePlan(context: PlanContext) {
    const started = performance.now();
    const modelId = await this.resolveModelId();

    const system = [
      "You are the planning component of Agent World OS.",
      "",
      "You do NOT execute actions.",
      "You only propose a short structured plan.",
      "Return valid JSON and nothing else.",
      "",
      "Required JSON schema:",
      '{"actions":[{"action":"say|goto|look_at|pick|drop|use|use_tool|delegate|ask_human|purchase_compute","targetId":"optional entity id","parameters":{}}]}',
      "",
      "Rules:",
      "- Only use actions listed in availableActions.",
      "- Only reference entity IDs present in entities.",
      "- Never invent an entity ID.",
      "- Never invent a tool.",
      "- Prefer the minimum number of actions.",
      "- A proposal is not execution.",
      "- For say, put the exact speech in parameters.text.",
      "- For goto or look_at, targetId must be a listed entity ID.",
      "- For purchase_compute, put requested units in parameters.units.",
      "- If the goal cannot be achieved with the listed entities/actions, use ask_human.",
      "- Do not claim that any action has already happened."
    ].join("\n");

    const user = JSON.stringify({
      goal: context.userGoal,
      agentId: context.agentId,
      availableActions: context.availableActions,
      entities: context.entities
    });

    const response = await fetch(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: this.headers(),

        body: JSON.stringify({
          model: modelId,
          temperature: 0,

          messages: [
            {
              role: "system",
              content: system
            },
            {
              role: "user",
              content: user
            }
          ]
        })
      }
    );

    if (!response.ok) {
      const body = await response.text();

      if (response.status === 401) {
        throw new Error(
          "llama.cpp request failed with HTTP 401. " +
          "Set LLAMA_API_KEY for Agent Runtime, or run llama-server without authentication."
        );
      }

      throw new Error(
        `llama.cpp request failed: HTTP ${response.status} ${body}`
      );
    }

    const json = await response.json() as any;

    const rawText =
      json?.choices?.[0]?.message?.content ??
      "";

    const plan = ProposedPlanSchema.parse(
      extractJson(rawText)
    );

    return {
      plan,
      rawText,
      model:
        typeof json?.model === "string"
          ? json.model
          : modelId,
      latencyMs:
        Math.round(performance.now() - started)
    };
  }
}
