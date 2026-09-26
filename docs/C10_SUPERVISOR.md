# C10 Supervisor

The Supervisor is a deterministic control plane. `tick(snapshot)` inspects trusted runtime facts and emits findings plus requests for restrictive actions. It has no model, planner, authority issuer, budget mutator, executor or effect settlement dependency.

Built-in rules cover emergency stop, task deadline/stall, expired authority/resource leases, unavailable budget, stuck preparing/dispatching effects, UNKNOWN without reconciliation, due/exhausted reconciliation, component/policy/event-store failure, UNKNOWN backlog/rate, reconciliation mismatch, committed effect without observation and completed task with an unresolved required effect. A dispatching timeout is uncertainty and requests reconciliation; it never marks the effect failed.

`mayStart()` blocks consequential work during emergency stop, control-plane failure or executor quarantine. Diagnostics, observation, read-only reconciliation and forensic reads remain available. Tick never clears emergency stop or quarantine; these stores are in memory. C11 will adapt live package state into snapshots and enforce the emitted stop requests before dispatch.
