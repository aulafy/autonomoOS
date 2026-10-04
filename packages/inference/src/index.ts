import { z } from "zod";

export type InferenceCapability = "text" | "structured_output" | "tools" | "vision";
export type InferenceHealthReason = "unavailable" | "authentication" |
  "malformed_response" | "model_unavailable" | "timeout";
export interface InferenceProviderHealth {
  ok: boolean;
  provider: string;
  endpoint: string;
  model?: string;
  latencyMs?: number;
  authConfigured: boolean;
  authRequired?: boolean;
  reason?: InferenceHealthReason;
  detail?: string;
}
export interface PlanContext {
  agentId: string;
  userGoal: string;
  availableActions: string[];
  entities: Array<{ id: string; kind: string; name: string; affordances: string[] }>;
  constraints?: string[];
}
export const ProposedActionSchema = z.object({
  action: z.enum(["say", "goto", "look_at", "pick", "drop", "use", "use_tool",
    "delegate", "ask_human", "purchase_compute", "file.read", "file.write",
    "api.create_record", "email.identify_contact", "crm.lookup_contact", "crm.propose_lead",
    "email.classify", "email.draft_reply", "email.review_reply", "email.send_reply",
    "crm.record_interaction", "crm.create_followup"]),
  targetId: z.string().optional(),
  parameters: z.record(z.unknown()).optional()
}).strict();
export const ProposedPlanSchema = z.object({
  actions: z.array(ProposedActionSchema).min(1).max(12)
}).strict();
export type ProposedAction = z.infer<typeof ProposedActionSchema>;
export type ProposedPlan = z.infer<typeof ProposedPlanSchema>;
export interface InferenceResult {
  plan: ProposedPlan;
  rawText: string;
  model?: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
}
export interface InferenceProvider {
  readonly id: string;
  capabilities(): Promise<InferenceCapability[]>;
  health(): Promise<InferenceProviderHealth>;
  proposePlan(context: PlanContext, options?: { signal?: AbortSignal }): Promise<InferenceResult>;
}
/** The whole model response must be JSON, without prose or fence extraction. */
export function parseStructuredPlan(text: string): ProposedPlan {
  return ProposedPlanSchema.parse(JSON.parse(text));
}

export class LlamaCppProvider implements InferenceProvider {
  readonly id = "llama.cpp";
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly timeoutMs: number;
  constructor(options?: { baseUrl?: string; apiKey?: string; model?: string;
    timeoutMs?: number }) {
    this.baseUrl = options?.baseUrl ?? process.env.LLAMA_BASE_URL ??
      "http://127.0.0.1:8080";
    const endpoint = new URL(this.baseUrl);
    if (endpoint.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/") {
      throw new Error("LOCAL_INFERENCE_ENDPOINT_REQUIRED");
    }
    this.apiKey = options?.apiKey ?? process.env.LLAMA_API_KEY ?? undefined;
    this.model = options?.model ?? process.env.LLAMA_MODEL ?? undefined;
    this.timeoutMs = options?.timeoutMs ?? 30000;
  }
  async capabilities(): Promise<InferenceCapability[]> {
    return ["text", "structured_output"];
  }
  private headers(): Record<string, string> {
    return { "Content-Type": "application/json",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) };
  }
  private async fetchModels(signal?: AbortSignal) {
    const started = performance.now();
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: this.headers(), redirect: "error", signal: signal ?
        AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) :
        AbortSignal.timeout(this.timeoutMs)
    });
    let body: unknown;
    try { body = await response.json(); } catch { body = null; }
    return { ok: response.ok, status: response.status, body,
      latencyMs: Math.round(performance.now() - started) };
  }
  private modelIds(body: unknown): string[] {
    if (typeof body !== "object" || body === null) return [];
    const record = body as Record<string, unknown>;
    const entries = record.data ?? record.models;
    return Array.isArray(entries) ? entries.map(entry => entry?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  }
  private async resolveModelId(signal?: AbortSignal): Promise<string> {
    const result = await this.fetchModels(signal);
    if (result.status === 401 || result.status === 403) throw new Error("INFERENCE_AUTHENTICATION");
    if (!result.ok) throw new Error(`INFERENCE_HTTP_${result.status}`);
    const ids = this.modelIds(result.body);
    if (this.model && !ids.includes(this.model)) throw new Error("MODEL_UNAVAILABLE");
    if (!ids.length) throw new Error("MALFORMED_MODEL_LIST");
    return this.model ?? ids[0]!;
  }
  async health(): Promise<InferenceProviderHealth> {
    try {
      const result = await this.fetchModels();
      const base = { provider: this.id, endpoint: this.baseUrl,
        authConfigured: Boolean(this.apiKey), latencyMs: result.latencyMs };
      if (result.status === 401 || result.status === 403) return { ...base, ok: false,
        authRequired: true, reason: "authentication" as const,
        detail: `HTTP ${result.status}` };
      if (!result.ok) return { ...base, ok: false, reason: "unavailable" as const,
        detail: `HTTP ${result.status}` };
      const ids = this.modelIds(result.body);
      if (!ids.length) return { ...base, ok: false, reason: "malformed_response" as const,
        detail: "Model list has no valid IDs." };
      if (this.model && !ids.includes(this.model)) return { ...base, ok: false,
        reason: "model_unavailable" as const,
        detail: `Requested model ${this.model} is not loaded.` };
      return { ...base, ok: true, authRequired: false, model: this.model ?? ids[0] };
    } catch (error) {
      return { ok: false, provider: this.id, endpoint: this.baseUrl,
        authConfigured: Boolean(this.apiKey),
        reason: error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
          ? "timeout" : "unavailable",
        detail: error instanceof Error ? error.message : String(error) };
    }
  }
  async proposePlan(context: PlanContext, options?: { signal?: AbortSignal }): Promise<InferenceResult> {
    const started = performance.now();
    const modelId = await this.resolveModelId(options?.signal);
    const system = [
      "You propose actions but cannot execute or authorize them.",
      "Return exactly one JSON object with actions; no prose or code fences.",
      '{"actions":[{"action":"one listed action","targetId":"one listed entity id","parameters":{}}]}',
      "Use only listed actions and entity IDs. Never invent resources or tools.",
      ...(context.availableActions.includes("file.write") ? [
        "For file.write, parameters must contain exact UTF-8 content and mode create or replace."
      ] : []),
      ...(context.availableActions.includes("file.read") ? [
        "For file.read, use empty parameters."
      ] : []),
      ...(context.availableActions.includes("api.create_record") ? [
        "For api.create_record, use a listed endpoint and parameters name (string), value (integer)."
      ] : []),
      ...(context.availableActions.includes("say") ? [
        "For say, put the exact speech in parameters.text."
      ] : []),
      ...(context.availableActions.includes("goto") ? [
        "For goto, targetId must be a listed entity ID."
      ] : []),
      "Prefer the fewest actions.",
      "A proposal is not execution. Do not claim completion.",
      ...(context.constraints ?? [])
    ].join("\n");
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST", headers: this.headers(), redirect: "error",
      signal: options?.signal ? AbortSignal.any([options.signal,
        AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({ model: modelId, temperature: 0, max_tokens: 1024,
        response_format: { type: "json_object" }, messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify({ goal: context.userGoal,
            agentId: context.agentId, availableActions: context.availableActions,
            entities: context.entities }) }
        ] })
    });
    if (response.status === 401 || response.status === 403) throw new Error("INFERENCE_AUTHENTICATION");
    if (!response.ok) throw new Error(`INFERENCE_HTTP_${response.status}`);
    const json = await response.json() as any;
    const rawText = json?.choices?.[0]?.message?.content;
    if (typeof rawText !== "string") throw new Error("MALFORMED_INFERENCE_RESPONSE");
    return { plan: parseStructuredPlan(rawText), rawText,
      model: typeof json?.model === "string" ? json.model : modelId,
      latencyMs: Math.round(performance.now() - started),
      usage: {
        ...(Number.isSafeInteger(json?.usage?.prompt_tokens) ?
          { inputTokens: json.usage.prompt_tokens as number } : {}),
        ...(Number.isSafeInteger(json?.usage?.completion_tokens) ?
          { outputTokens: json.usage.completion_tokens as number } : {})
      } };
  }
}

export { LocalJsonProvider, type JsonProposalProvider, type JsonProposalResult } from './local-json.js';
