# AW2-1 — Global task kernel

## Ownership

`packages/task-runtime` owns `GlobalTask`, `WorkUnit`, `Attempt`, criterion
contracts, event transitions and deterministic projection. It executes nothing.
The legacy protocol Task and H1 task journal remain compatible and separate.

The kernel accepts trusted host events. It is not exposed as a public API and does
not grant policies, leases, budgets or credentials. A provider must never receive
access to `apply`. AW2-7 will implement independent verifiers; AW2-10 will submit
their results through the governed host. Kernel tests use host-authored evidence
references, not a production verifier or a working Orca adapter.

## Events and progression

- Create a goal with owner and nonempty explicit success criteria.
- Start planning and atomically commit a versioned, acyclic plan.
- Only dependency-ready units can obtain an active attempt.
- Reserve, persist dispatch intent, then record provider dispatch references.
- A provider report, including reported failure, advances to verification.
- Record scoped evidence, start verification, and record every criterion result.
- Satisfied criteria finish the attempt/unit; unsatisfied criteria block the task;
  unverifiable criteria preserve UNKNOWN and the active attempt identity.
- Global completion additionally requires all units succeeded and all goal criteria
  satisfied. Successful units alone cannot complete the goal.

No direct “set status to succeeded” API exists. Historical plans, attempts,
provider-reported outcomes, verification records and decision/evidence references
are preserved. Additive replans create new units and keep prior plan records;
replacement/supersession policy is a later planner milestone.

## Safety boundaries

UNKNOWN cannot become failure or a replacement attempt by ordinary dispatch/report.
A trusted reconciliation event requires evidence scoped to the original attempt.
Proven not-executed frees that unit for a new attempt; proved-running resumes
observation; reported-success returns to verification. Stale attempt reports fail.

The kernel refuses cancellation while any authoritative attempt is unresolved.
Provider cancellation and observation semantics are later milestones. An
unsatisfied verification leaves a failed unit blocked: authorizing retries after
actual effects needs the governed recovery path, not a convenience reset.

SuccessCriterion supports test, HTTP, file, schema, observation, human approval and
custom descriptors. Storing a test command does not authorize or execute it.
Detailed assertion interpretation is owned by the verifier milestone.

## Persistence and replay

`createDurableTaskRuntime` in `runtime-store-sqlite/src/global-task-store.ts`
registers the `aw2TaskRuntime.apply` mutator on the existing H1 JournalKernel.
Register it before `restore()`. Registration does not modify legacy command names,
legacy task data or database schema. The host must register all stores present in
its database; unknown journal commands fail closed.

Each event requires an expected global projection revision. Duplicate exact events
return the original receipt; conflicting reuse of an event ID fails. Validation
operates on a private copy, so rejected events cannot partially change state.
Receipts include a SHA-256 digest of the authoritative projection, allowing H1
replay checks to detect changes in reducer semantics, not merely event counts.
The H1 journal is authoritative; snapshots are detached operator projections.

## Verification

Kernel tests cover creation, invalid transitions, cycles/missing dependencies,
readiness, single active attempt, completion gates, false provider success,
UNKNOWN, scoped evidence, blocked propagation, duplicates and deterministic replay.
The SQLite integration tests additionally compare complete projections across a
real fresh-process SIGKILL, preserving DAG, active identity, provider IDs and
references, and reject unsafe redispatch after restoration. A compatibility test
replays legacy and V2 task stores in the same database.

AW2-1 supplies lifecycle and durability behavior. Provider registries, Orca,
routing, context, independent verifier execution, scheduling and the control API
remain subsequent milestones.
