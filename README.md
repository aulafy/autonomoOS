# Agent World OS

Agent World OS is a local prototype for governed AI actions. A model can propose
an action, but the control plane checks authority, resource scope, data flow,
budget, composition policy, and supervision before execution. It then observes
the external result before confirming the effect. SQLite journals control facts
and supports recovery after process death.

The current implementation includes C1–C12, H1 durable runtime, H2 filesystem
effects, H3 local inference, and H4 restricted HTTP/API effects. See
[implementation status](docs/IMPLEMENTATION_STATUS.md) for verified milestones
and limitations.

## Install and verify

```bash
npm install
npm test
npm run typecheck --workspaces --if-present
npm run build
```

## Run the demos

`npm run demo:h4:lost-response` is self-contained. It starts a separate API
fixture, performs one governed POST, intentionally loses the response, prints
the persisted `UNKNOWN` state, restarts the runtime, reconciles with a GET, and
prints the confirmed state. Its output includes paths to both SQLite databases.
No local model server is required.

For a natural-language demo, start a local Qwen server in one terminal:

```bash
env -u LLAMA_API_KEY -u LLAMA_ARG_API_KEY_FILE \
  llama-server -hf Qwen/Qwen3-4B-GGUF:Q4_K_M \
  --host 127.0.0.1 --port 8080 -c 8192
```

Then run `npm run demo:h4` in another terminal. Qwen proposes
`api.create_record`; the control plane governs a POST to a separate fixture
process and confirms the result by GET. `npm run demo:h3` demonstrates a
governed filesystem write instead. These demos require a locally available
model and `llama-server` executable.

To see the Three.js world, run `npm run dev:runtime` and `npm run dev:world` in
separate terminals, then open the Vite URL. The WebSocket runtime is currently
loopback-only; authenticated remote control is future work.

## Design boundaries

- The model cannot grant itself authority or choose an arbitrary network URL.
- A successful executor report alone does not prove an external effect.
- An uncertain HTTP outcome is reconciled by read-only lookup. It is never
  blindly redispatched.
- H4 does not claim exactly-once HTTP effects. If the provider cannot prove
  the outcome, an effect may remain `UNKNOWN`.

Read [H4 HTTP/API effects](docs/H4_HTTP_API_EFFECTS.md) and
[durable runtime](docs/H1_DURABLE_RUNTIME.md) for implementation details.
