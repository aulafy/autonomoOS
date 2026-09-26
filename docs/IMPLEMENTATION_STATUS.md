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
| C9 InformationFlowPolicy | Planned | — | — | — | — | — | — |
| C10 Supervisor | Planned | — | — | — | — | — | — |
| C11 GovernedActionRunner | Planned | — | — | — | — | — | — |
| C12 Crash Recovery | Planned | — | — | — | — | — | — |
