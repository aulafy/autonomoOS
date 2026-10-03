# Agent World OS V2 — Universal Task Runtime

> Models propose. The Global Task Runtime owns state. Policies authorize. Providers execute. Effects change the world. Observations produce evidence. Verifiers determine whether success criteria are satisfied.

## Implementation progress

| Milestone | State | Evidence |
|---|---|---|
| AW2-0 audit | Complete | [Architecture map](AW2_ARCHITECTURE_MAP.md); baseline 515 tests, workspace types/build passed |
| AW2-1 global task kernel | Implemented and tested | [Task model](AW2_TASK_MODEL.md); 13 kernel tests and 2 durable integration tests including fresh-process SIGKILL; full repository 530 tests, workspace types/build passed |
| AW2-2 provider contract | Implemented and tested | [Provider contract](AW2_EXECUTION_PROVIDERS.md); 9 tests including registry races and mock global lifecycle; full repository 539 tests, workspace types/build passed |
| AW2-3 Orca provider | Implemented and tested | [Orca adapter](AW2_ORCA_PROVIDER.md): real CLI transport, durable dispatch, scoped completion/question/escalation reception, durable replies and read-only lost-receipt recovery; global signal events survive SIGKILL; 32 adapter tests (31 passed, 1 opt-in live check skipped); full repository 572 tests (571 passed, 0 failed, 1 skipped), workspace types/build passed. Real 1.4.218 status probe passed previously; live coding execution has not been run |
| AW2-4 capability registry and router | Implemented and tested | [Routing](AW2_ROUTING.md): mandatory admission before deterministic scoring, valid pins, immutable reproducible decisions, H1 persistence; 12 new tests, full repository 584 tests (583 passed, 0 failed, 1 skipped), workspace types/build passed |
| AW2-5 context engine | Implemented and tested | [Context engine](AW2_CONTEXT_ENGINE.md): labelled goal/objective and scoped sources, C9 integration, explicit exclusions, immutable versions/provenance, revalidated rendering and H1 persistence; 17 new tests, full repository 601 tests (600 passed, 0 failed, 1 skipped), workspace types/build passed |
| AW2-6 decision ledger and artifacts | Implemented and tested | [Records](AW2_RECORDS.md): append-only decisions/supersession, immutable artifact metadata/provenance, labelled current-decision handoff and H1 registration; 10 new tests including fresh-process SIGKILL; full repository 611 tests (610 passed, 0 failed, 1 skipped), workspace types/build passed |
| AW2-7 evidence and verification | In progress | [Verification](AW2_VERIFICATION.md): evidence ledger, registry, six deterministic evaluator kinds, bounded schema worker, production C12 collector and durable collection claims; 15 additional tests in this increment; full repository 631 tests (630 passed, 0 failed, 1 skipped), workspace types/build passed. Host attempt verification bridge now stores scoped outcomes before kernel transitions; four lifecycle/failure tests added, registry now bounds deadlines/cancellation and rejects malformed evidence; global verification kernel outcomes now preserve failure/UNKNOWN independently of unit success; reverification rounds preserve prior evidence after reconciliation; real filesystem digest/existence adapter tested; full C12 real-file success/failure acceptance verified; host-configured production filesystem verifier added; full repository 649 tests (648 passed, 0 failed, 1 skipped). Actual command/file/HTTP observer configuration, task-level verification and real execution acceptance remain pending |
| AW2-8–15 | Pending | Follow the reference specification and preserve the existing governance gates |

Validation date: 2026-10-03, Europe/Madrid.

## Current integration

`@agent-world/task-runtime` is a provider-independent deterministic lifecycle
projection. `@agent-world/runtime-store-sqlite` registers its mutations on the
existing H1 journal. The runtime host can opt into this registration without
changing legacy task stores or their historical commands.

The kernel records explicit host verification/reconciliation results and enforces
lifecycle transitions. It does not itself run verifiers, dispatch providers,
plan with a model or authorize real effects. Those are subsequent milestones,
not implicit capabilities of a successful kernel test.

## Commands

```bash
npm run test --workspace @agent-world/task-runtime
npm run test --workspace @agent-world/runtime-store-sqlite
npm test
npm run typecheck --workspaces --if-present
npm run build
```

The full workspace commands cover scripts declared by each workspace. Live Orca
and paid/cloud agent tests are not part of the default test gate.

## Interface read model

Owner-scoped runtime DTO added; see [interface integration](AW2_RUNTIME_INTERFACE.md). Full repository: 652 tests, 651 passed, 0 failed, 1 optional skip; workspace types and build passed. Authenticated endpoint and live client remain pending.

Authenticated PYMES runtime endpoint added with tenant/source mapping and readRuntime permission. Full repository: 656 tests, 655 passed, 0 failed, 1 skipped; types/build passed. Startup durable source and live frontend remain pending.

PYMES startup now injects a tenant-bound persistent H1 task journal. Reopen-to-authenticated-endpoint acceptance passed. Full repository: 657 tests, 656 passed, 0 failed, 1 skipped; types/build passed. Host task orchestration and live frontend remain pending.

Authenticated browser runtime client and DTO validation added. Full repository: 659 tests, 658 passed, 0 failed, 1 skipped; types/build passed. Live screen rendering and task orchestration remain pending.

Authenticated task creation intake and live form added, durable/idempotent acceptance and browser create/reload verified. Full repository: 661 tests, 660 passed, 0 failed, 1 skipped; types/build passed. Planning and actor execution remain pending.
