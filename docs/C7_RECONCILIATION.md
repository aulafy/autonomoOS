# C7 Reconciliation

An `unknown` C6 transaction remains historically `unknown`. C7 appends a separate decision after asking a reconciler to look up current provider or world state. It never dispatches the original action and has no retry-effect API. Its queue retries *lookups* only.

The fixture reconciler returns deterministic observations for tests. C5 policy evaluates their strength, freshness, subject and expected postcondition. Accepted confirmation yields `confirmed_effect`. Accepted contradiction yields `confirmed_no_effect` only with a provider guarantee that the matching idempotency key was never processed, including an authority and lookup reference. A bare 404 or postcondition absence is ambiguous because an action may have happened and later been reversed. Accepted evidence on both sides yields `conflicting`. Insufficient evidence yields `ambiguous`; supersession requires an explicit reason and reference. Decisions are append-only records separate from C6.

`resolveEffectiveEffectOutcome()` is a deterministic read model: historical C6 `unknown` plus a confirmed C7 decision projects to effective `committed`; certified absence projects to `failed`; ambiguity, conflict and supersession remain effectively `unknown`. Each later decision explicitly names the decision it supersedes. The queue rejects self references, cross-effect references and duplicate heads, while older decisions remain queryable.

The queue, decisions and observations are in memory. Durable atomic updates, provider-specific read-only adapters, and governed authorization for any new transaction remain future work. C7 is not wired into M5.
