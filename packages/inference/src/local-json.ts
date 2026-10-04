/** Local structured proposals share the inference boundary, never execution authority. */
export interface JsonProposalResult { value: unknown; model: string; latencyMs: number }
export interface JsonProposalProvider {
  readonly id: string;
  proposeJson(input: { system: string; data: unknown; schema: Record<string, unknown> }, signal?: AbortSignal): Promise<JsonProposalResult>;
}
async function boundedJson(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw new Error('LOCAL_JSON_INVALID_RESPONSE');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.byteLength;
    if (size > 65536) throw new Error('LOCAL_JSON_RESPONSE_LIMIT'); chunks.push(r.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<string, unknown>;
  } finally { await reader.cancel().catch(() => undefined); }
}
export class LocalJsonProvider implements JsonProposalProvider {
  readonly id: string; private base: URL; private kind: 'ollama' | 'llama.cpp'; private model: string; private timeout: number;
  constructor(private options: { kind?: 'ollama' | 'llama.cpp'; model?: string; baseUrl?: string; apiKey?: string; timeoutMs?: number; fetcher?: typeof fetch } = {}) {
    this.kind = options.kind ?? 'ollama'; this.id = this.kind + '-local-json';
    this.base = new URL(options.baseUrl ?? (this.kind === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8080'));
    if (this.base.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(this.base.hostname) || this.base.username || this.base.password || this.base.pathname !== '/' || this.base.hash || this.base.search) throw new Error('LOCAL_JSON_ENDPOINT_REQUIRED');
    this.model = options.model ?? 'llama3.2:3b'; this.timeout = options.timeoutMs ?? 60000;
    if (!/^[a-zA-Z0-9_.:/-]{1,120}$/.test(this.model) || !Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 60000) throw new Error('LOCAL_JSON_CONFIG_INVALID');
  }
  async proposeJson(input: { system: string; data: unknown; schema: Record<string, unknown> }, signal?: AbortSignal): Promise<JsonProposalResult> {
    if (!input.system || input.system.length > 6000 || JSON.stringify(input.data).length > 18000 || JSON.stringify(input.schema).length > 12000) throw new Error('LOCAL_JSON_INPUT_LIMIT');
    const started = performance.now(), messages = [{ role: 'system', content: input.system }, { role: 'user', content: JSON.stringify(input.data) }];
    const request = this.kind === 'ollama' ? { model: this.model, stream: false, think: false, format: input.schema, options: { temperature: 0, num_predict: 1400 }, messages }
      : { model: this.model, temperature: 0, max_tokens: 1400, response_format: { type: 'json_schema', json_schema: { name: 'mail_assistance', strict: true, schema: input.schema } }, messages };
    try {
      // A loopback Ollama daemon may route a cloud model remotely. Preflight the
      // actual model before sending mail; a local URL alone does not prove locality.
      if(this.kind==='ollama'){
        const metaResponse=await (this.options.fetcher??fetch)(new URL('/api/show',this.base),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(this.timeout)]):AbortSignal.timeout(this.timeout),body:JSON.stringify({model:this.model})});
        if(!metaResponse.ok)throw new Error('LOCAL_JSON_MODEL_UNAVAILABLE');
        const meta=await boundedJson(metaResponse);
        if(meta.remote_host||meta.remote_model||!meta.model_info||typeof meta.model_info!=='object'||!Object.keys(meta.model_info).length)throw new Error('LOCAL_JSON_LOCAL_MODEL_REQUIRED');
      }
      const response = await (this.options.fetcher ?? fetch)(new URL(this.kind === 'ollama' ? '/api/chat' : '/v1/chat/completions', this.base), {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', ...(this.options.apiKey ? { Authorization: 'Bearer ' + this.options.apiKey } : {}) },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(this.timeout)]) : AbortSignal.timeout(this.timeout), body: JSON.stringify(request) });
      if (!response.ok) throw new Error('LOCAL_JSON_UNAVAILABLE');
      const data = await boundedJson(response);
      if(data.remote_host||data.remote_model)throw new Error('LOCAL_JSON_LOCAL_MODEL_REQUIRED');
      const message = this.kind === 'ollama' ? data.message : (data.choices as { message?: unknown }[] | undefined)?.[0]?.message;
      if (!message || typeof message !== 'object') throw new Error('LOCAL_JSON_INVALID_RESPONSE');
      const m = message as { content?: unknown; tool_calls?: unknown };
      if (typeof m.content !== 'string' || m.content.length > 16000 || (Array.isArray(m.tool_calls) && m.tool_calls.length) || (this.kind === 'ollama' && data.done !== true)) throw new Error('LOCAL_JSON_INVALID_RESPONSE');
      // Never forward reasoning/tool calls/raw response or provider errors to the product.
      return { value: JSON.parse(m.content), model: this.model, latencyMs: Math.round(performance.now() - started) };
    } catch (e) { if (signal?.aborted) throw new Error('LOCAL_JSON_CANCELLED');
      if (e instanceof Error && e.message.startsWith('LOCAL_JSON_')) throw e;
      throw new Error('LOCAL_JSON_FAILED'); }
  }
}
