# Implementation status

The repository and its tests are authoritative. Counts below are workspace totals at each milestone close.

| Milestone | Status | Package | Commit | Tag | Tests | Integration | Known limit |
|---|---|---|---|---|---:|---|---|
| C1 SessionContract / M5 baseline | Complete | `contracts`, M5 apps | `6c88dc2` | — | Baseline | M5 | In-memory control plane |
| C2 ResourceRegistry | Complete | `resources` | `e8ca14f` | — | — | Package | In-memory registry |
| C3 Leases | Complete | `leases` | `650c0f6` | — | — | Package | In-memory stores |
| C4 BudgetLedger | Complete | `budgets` | `df91766` | — | — | Package | In-memory ledger |
| C5 Observation | Complete | `observation` | `da0f82d` | — | 79 | Package | Fixture observers |
| C6 EffectTransaction | Complete | `effects` | `a9e9b57` | `c6-effect-transaction` | 107 | Package | In-memory effect/event stores |
| C7 Reconciliation | Complete | `reconciliation` | `e12431a` | `c7-reconciliation` | 121 | Package | Fixture reconciler |
| C8 CompositionPolicy | Complete | `composition-policy` | See tag | `c8-composition-policy` | 139 | Package only | In-memory history; C11 integration pending |
| C9 InformationFlowPolicy | Complete | `information-flow` | See tag | `c9-information-flow` | 151 | Package only | In-memory data/working-set stores; C11 integration pending |
| C10 Supervisor | Complete | `supervision` | See tag | `c10-supervisor` | 159 | Package only | In-memory control state |
| C11 GovernedActionRunner | Complete | `control-plane`, M5 runtime | `f59cb25` | `c11-governed-runner` | 174 | Live M5 demo | In-memory authority/effects; weak speech evidence |
| C12 Crash Recovery | Complete (storage-interface semantics) | `recovery`, M5 startup | See tag | `c12-crash-recovery` | 186 | Recovering mode gates demo runtime | In-memory stores do not survive a real process crash |
| H1 Durable Runtime | Complete | `runtime-store-sqlite`, M5 runtime | See tag | `h1-durable-runtime` | 199 | SQLite command journal, projection replay, fresh-process SIGKILL A–H and C11 restart | Three.js world state is still an in-process demo; see [H1 details](H1_DURABLE_RUNTIME.md) |
| H1.1 Post-commit publication | Complete | `runtime-store-sqlite`, M5 runtime | `bcb4f7f` | `h1.1-post-commit-publication` | 202 | WebSocket delivery only after outer SQLite commit; missed delivery replayable | Local live delivery is not guaranteed; replay recovers it |
| H2 Filesystem effect | Complete | `filesystem`, C11 runtime | See tag | `h2-filesystem-effect` | 222 | Governed read/write, independent disk hash, C7 recovery and SIGKILL A–F | Host-controlled workspace directories required; see [H2 details](H2_FILESYSTEM_EFFECT.md) |
| H3 Local inference | Complete | `inference`, H3 runtime | See tag | `h3-local-inference` | 234 | Local Qwen proposes a governed file write; C11, disk observer and task acceptance confirm it | H3 natural-language path is limited to `file.write`; see [H3 details](H3_LOCAL_INFERENCE.md) |
