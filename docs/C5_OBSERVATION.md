# C5 — Observation and evidence policy

An executor report is not observed reality. `@agent-world/observation` records what a configured observer saw against an explicit structured postcondition. Observations are append-only: later evidence creates a new record instead of changing an earlier `unknown` record. The store keeps evidence references, not full sensitive payloads.

The raw status (`confirmed`, `contradicted`, `unknown`, `inconclusive`, `stale`) is separate from the policy decision. A raw `confirmed` result is accepted only when it matches the task, intent, execution, effect, resources and postcondition hash, is fresh, passes resource-generation checks when requested, and has enough evidence strength for the risk class. Weak self-reports cannot confirm high-risk results. Conflicting accepted observations evaluate to `inconclusive`.

An observer error or timeout records `unknown`, never `contradicted`. Observers are registered by host code and should read or inspect; they do not execute the effect they observe. A model string or memory claim does not become an accepted Observation. Evidence does not grant authority, settle a budget, renew a lease or complete a task.

The in-memory stores and observer fixtures are C5 foundations. No M5 runtime integration, real provider observer, EffectTransaction or reconciliation is implemented here.
