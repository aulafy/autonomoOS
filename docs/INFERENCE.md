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

The local model may propose a structured plan.

It may **not execute it**.

Flow:

```text
Human goal
  ↓
LlamaCppProvider
  ↓
ProposedPlan
  ↓
Zod validation
  ↓
UI displays proposal
```

The next milestone will convert each proposed action into a real ActionIntent and
send it through the existing policy / execution / observation lifecycle.
