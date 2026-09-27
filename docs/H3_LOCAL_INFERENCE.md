# H3 — Local inference end to end

H3 starts from `h2-filesystem-effect` (`652eabb`). A natural-language goal reaches a local llama.cpp provider, but the returned plan is untrusted data. `H3GoalService` in `apps/agent-runtime/src/h3-goal-service.ts` is the host boundary. It accepts one host-selected registered file and one `file.write` proposal, validates the complete raw model response, constructs an `ActionIntent` with model provenance, stages the proposed bytes under C9, and calls `createDemoControlPlane().run`. The service has no reference to a filesystem executor or world executor.

## Authority and context

The host creates a C1 contract, C3 authority lease/grant, and C4 budget before inference. The H3 grant contains only the chosen file resource and `file.write`. Model fields for principal, grant, approval, capability, or other actions are rejected. C2 resolves the proposed target and requires it to match the host-selected resource. The prompt includes only the goal, `file.write`, the canonical file ID and safe display name; it contains no absolute workspace path, SQLite path, authority object, executor, or full history. Goals are capped at 8192 characters. The human/host must also provide `expectedContent`; its SHA-256 is bound in contract metadata and checked against the proposed bytes before dispatch. This explicit acceptance input prevents the model from declaring a semantically wrong write successful.

The human goal is conservatively labeled `secret` in C9. A host-owned `model_provider` sink with `local` trust must allow this flow before the prompt is sent. Model-generated write bytes are also staged as a secret C9 object. C8 and C9 run again through C11 at admission and the live commit gate; a public file sink or sensitive-read history can block the write. No inference call registers a new resource or changes an approval.

## Provider and output

`LlamaCppProvider` uses the OpenAI-compatible llama.cpp HTTP API and accepts only a loopback `LLAMA_BASE_URL` (`127.0.0.1`, `localhost`, or `::1`). `LLAMA_MODEL` selects a specific loaded model when supplied; a missing requested model fails explicitly. `LLAMA_API_KEY` is optional. Health reports unavailable, authentication, malformed model list, missing model, or timeout. The provider requests JSON object mode, caps output at 1024 tokens, and applies a 30-second timeout by default. The complete response must be a JSON object matching the strict proposal schema. Prose, code fences, extra action fields and unsupported actions are rejected. There is no cloud fallback.

One format retry is permitted before execution. Provider failures and timeouts stop planning. Once C11 has started an effect, H3 never asks the model to retry the write. C6/C7/C12 own an uncertain effect. The output of the model is never treated as confirmation of success: C5's independent filesystem observation and task acceptance are required.

## Provenance and budget

`inference.requested`, `inference.completed`, `inference.failed`, `plan.proposed`, `action.proposed`, denials and task outcomes are durable runtime events. The H1.1 publisher notifies WebSocket clients only after SQLite commit. Events retain task/request IDs, provider, model, latency, token usage when available, and SHA-256 hashes of prompt and raw response. They do not persist full prompt or response text by default. The `ActionIntent` carries the corresponding hashes and IDs.

Each attempt reserves 16,384 inference tokens from the task's 32,768-token C4 ceiling. If both usage counts are returned, the exact sum is committed; if unavailable, the reservation is released and usage remains explicitly unknown in provenance. The budget is a bounded seam, not a claim that llama.cpp always reports usage. The demo reports inference, combined control-plane and total task latency. Admission, executor and observation times are not separately instrumented yet.

## Run the live demo

The installed `llama-server` supports `-hf`, `--host`, `--port`, and `-c`. Start the cached or downloadable Qwen model in a separate terminal:

```bash
env -u LLAMA_API_KEY -u LLAMA_ARG_API_KEY_FILE \
  llama-server -hf Qwen/Qwen3-4B-GGUF:Q4_K_M \
  --host 127.0.0.1 --port 8080 -c 8192
```

Then run `npm run demo:h3` from the repository root. The script checks provider health first, creates a fresh temporary workspace and SQLite database, and submits: “Astra, create hello.txt in the workspace and write exactly: Hello from Agent World OS.” It prints the structured task/effect/observation result, actual bytes, workspace path and database path. If inference is unavailable it exits with a startup command and does not create a task or workspace. Automated tests use deterministic fake providers and never download a model.

The WebSocket runtime also uses the same `H3GoalService` when `agent.goal.run` includes a `targetId`. The host allowlist comes from `AGENT_WORLD_H3_TARGETS` or `AGENT_WORLD_REGISTERED_FILES`; `AGENT_WORLD_WORKSPACE_ROOT` supplies the H2 workspace. `expectedContent` is required and binds exact human-specified bytes. Existing `agent.goal.run` messages without `targetId`, M5 actions, Three.js world, and replay retain their previous path. The WebSocket server listens on loopback by default; this demo protocol has no user authentication and should not be exposed to a network.

## Threat model and limits

Tests force malicious proposals, invented resources, actions, grants and approvals, prompt-injection text, revoked authority, C8 and C9 denials, malformed output, provider errors and timeout. They verify zero unauthorized disk mutation. H2's remaining same-account concurrent path-swap TOCTOU limitation still applies. H3 currently implements `file.write` only; governed `file.read` remains available through H2 but has no natural-language H3 route. The expected-content check is supplied by the human/host, not inferred from arbitrary prose. This milestone does not add browser, shell, HTTP executor, MCP, A2A or cloud inference.
