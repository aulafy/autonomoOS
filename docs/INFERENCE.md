# Inference Architecture

Agent World OS separates the persistent Agent Engine from inference engines.

The Agent Engine owns:

- identity
- memory
- goals
- policies
- tools
- world state
- provenance
- execution lifecycle

Inference providers only provide cognition.

Initial provider:

- llama.cpp through its OpenAI-compatible HTTP server

Future providers:

- MLX
- Ollama
- vLLM
- cloud APIs
- specialist external agents

## Current milestone

H3 connects a narrow local `file.write` proposal to the governed C11 runtime.
The model still cannot execute or authorize actions. The host validates the
complete response, resolves a pre-registered resource, creates an ActionIntent,
and sends it through C1–C12 and H2. A disk observation determines success.

See [H3_LOCAL_INFERENCE.md](H3_LOCAL_INFERENCE.md) for the provider contract,
security boundary, live Qwen demo and limits. The original M5 plan-preview path
remains available for the Three.js demo.

H4 also permits the semantic `api.create_record` proposal for a host-selected
canonical endpoint and caller-supplied expected record. The model receives no
URL or credential authority. The API effect is confirmed through a separate
provider lookup; see [H4_HTTP_API_EFFECTS.md](H4_HTTP_API_EFFECTS.md).
