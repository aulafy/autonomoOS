# C8 CompositionPolicy

Individually allowed actions do not make their sequence safe. C8 evaluates a host-classified candidate against append-only, task-scoped facts compiled from accepted C5 observations and C6 effects. A replan changes the plan, not the task history. Payment and external-send attempts become facts after the dispatch boundary and survive C6 `unknown` and any later C7 resolution.

Rules are deterministic. `deny` outranks `require_approval`, which outranks `allow`. The initial rules cover sensitive reads before external sends, secrets or credential context before public publishing, credential access before untrusted code, repeated payment attempts, untrusted code before robot actions, and unknown sink trust. C8 is a broad sequence-risk screen; C9 will bind exact data objects and flows.

The candidate compiler takes action class from the host ActionRegistry and sink trust from ResourceRegistry. Model text does not classify either. The history store is a host control-plane store; producers should use FactCompiler to project trusted records. It tracks a per-task history version. A decision records that version and `isCurrent()` detects a stale decision after any new fact. C11 must re-evaluate before commit.

Approvals are auditable, expiring records scoped to task, intent, action, exact resources, sink and history version. They satisfy `require_approval` only for that context and never override `deny`. Approval is not authority. A composition `allow` means only that this layer did not block the candidate; it does not permit execution. Stores are in memory and C8 is not wired into M5.
