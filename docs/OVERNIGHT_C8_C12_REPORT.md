# Agent World OS: C8–C12 implementation report

## Starting state

The real repository at `/Users/mac/Downloads/agent-world-os` was used as the source of truth. C7 was at `e12431a` (`c7-reconciliation`), with 121 tests. The work continued on `codex/overnight-c8-c12`; no earlier milestone was rebased or reset.

## Milestones

| Milestone | Result | Commit | Tag | Workspace tests at close |
|---|---|---|---|---:|
| C8 CompositionPolicy | History-aware sequence rules, exact approvals, effect/observation fact projection | `eaf0461` | `c8-composition-policy` | 139 |
| C9 InformationFlowPolicy | Labeled data lineage, task working set, sink policy, release approvals | `e9bf58b` | `c9-information-flow` | 151 |
| C10 Supervisor | Deterministic restrictive rules, emergency stop, quarantine | `e652992` | `c10-supervisor` | 159 |
| C11 GovernedActionRunner | Live Commit Gate, budget/effect/observation chain, M5 adapter, acceptance evaluator | `f59cb25` | `c11-governed-runner` | 174 |
| C12 Crash Recovery | Read-only startup, safe effect classification, reconciliation and accounting repair | See tag | `c12-crash-recovery` | 186 |

## Files and integrations

Created packages: `packages/composition-policy`, `packages/information-flow`, `packages/supervision`, `packages/control-plane`, `packages/recovery`. Created milestone tests and `docs/C8_COMPOSITION_POLICY.md` through `docs/C12_CRASH_RECOVERY.md`. Updated `apps/agent-runtime` to route M5 demo actions through the governed path and to start in recovery mode. Small compatible changes were made to `budgets`, `effects`, `protocol`, `package-lock.json`, and `docs/IMPLEMENTATION_STATUS.md`.

The pipeline now connects C1 contracts, C2 canonical resources, C3 leases, generic policy, C8 composition, C9 information flow where required, C4 budget reservations, C6 effect state, execution, C5 observation, C7 reconciliation, C10 supervision, and acceptance evaluation. Host registries select executors and observers. The model proposes intents and cannot call `world.execute` directly.

## Verification

- `npm run typecheck --workspaces --if-present`: all available workspace typechecks passed.
- `npm test`: 186 tests passed, zero failures. The C12 package has 11 crash-window tests.
- `npm run build`: Three.js world-client build passed.
- `git diff --check`: passed.
- WebSocket smoke test after C12 startup: `goto` returned `observed` and emitted the movement event. Before C12, `say` returned `observed` and `purchase_compute` was denied.
- `LlamaCppProvider`, the goal planning path, JSONL replay, and the Three.js client remain present. The local llama.cpp endpoint was unavailable during the smoke test, so inference quality and live goal execution were not exercised.

The tests verify revoked grants, changed resource generations/fences, stale composition and flow contexts, expired release approvals and budget reservations, emergency stop/quarantine, executor success followed by uncertain observation, required acceptance evidence, no completion with `UNKNOWN`, crash classification, deduplicated reconciliation, persisted-observation settlement, accounting repair, and no recovery redispatch.

## Known limits

The control-plane stores remain in memory. JSONL captures runtime provenance and replay events, but it does not rebuild effects, budgets, C8 history, C9 lineage, emergency stop or quarantine after a real process restart. C12's semantics are verified against injected stores and should not be represented as production crash durability. The M5 adapter uses demo host grants and an in-process observer; its speech evidence is weak. The recovery manager accepts health callbacks from a future durable host, which must validate its event sequence and projections before returning healthy. No durable database, external provider adapter, or production authority service was added.

## Next work

Stop architectural expansion at C12. A later hardening milestone should add durable transactional projections, startup integrity checks and real observer/provider adapters before claiming process-crash safety.
