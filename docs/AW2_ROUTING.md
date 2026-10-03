# AW2-4 — Capability registry and deterministic routing

`@agent-world/capabilities` defines an explicit capability catalog, independent of
provider brands. The default catalog follows V2's capability examples. Hosts may
register additional named capabilities before building a routing snapshot; unknown
WorkUnit requirements are rejected rather than silently ignored.

`@agent-world/routing` exposes a pure `route(request, capabilityRegistry?)` function
with pinned and deterministic modes. Learned routing remains a later milestone.
It performs no provider calls, filesystem commands or model requests.

## Mandatory admission before score

The request contains a captured WorkUnit, candidate actor metadata, provider
availability and trusted host evaluations at an explicit policy snapshot reference.
Policy, information flow and resource access must each be allowed. Actor/provider
availability, capability confidence, actor capability constraints, WorkUnit rule
constraints, minimum trust, locality, residency, optional latency bounds, currency
and remaining monetary budget are hard filters. Pins constrain admission too;
an invalid pinned selection produces `pinned-actor-invalid`, without fallback.

Unknown costs are not zero. A missing cost estimate, currency mismatch or estimate
above the captured remaining budget excludes the actor. This is estimate-based
admission, not a budget reservation or financial charge. AW2-10 must enforce the
existing budget ledgers, leases/fencing and effect policy at actual execution.
Host evaluations are supplied by trusted code; this module does not interpret a
boolean or a snapshot reference received from a model as execution permission.

Allowed residencies require nonempty declared residency metadata, and every declared
residency must be allowed. Unknown latency is penalized at the maximum normalized
latency; when a latency bound is mandatory, unknown latency is excluded. Unknown
capability confidence and unsatisfied rule references cannot become eligibility.

## Ranking and explanation

For eligible candidates only:

```text
capabilityFit*W1 + reliability*W2 + contextLocality*W3 + privacyFit*W4
  - normalizedCost*W5 - normalizedLatency*W6
```

Capability fit is mean confidence over required capabilities. Reliability and
context locality are explicit configured host priors in [0,1]. Privacy fit is an
initial heuristic: local=1, remote=0.5. Cost/latency are clamped to [0,1] against
explicit normalization constants. Weights are captured with each decision, using
V2's proposed initial values as an exported configuration example. These numbers
are heuristics, not measured guarantees of quality or completion time.

Ties use ascending actor ID in a locale-independent comparison. Candidate order
does not change a decision. The decision includes all considered actors, exclusion
codes, eligible component scores, selected IDs, policy/budget snapshot references,
timestamp, captured input and capability catalog. Its ID is a SHA-256 digest of
that canonical record. Input objects are detached and never mutated.

## Persistence and replay

`RoutingDecisionStore.record` reconstructs the decision from its captured input
and catalog before accepting it. Altered selection, scores or explanation fail
validation. Records are immutable and reads are detached; identical records are
idempotent. `createDurableRoutingStore` registers `aw2RoutingDecisions` on the
existing H1 journal before restore. Reopening SQLite restores the full explanation
and produces the same routing decision from the recorded inputs. Old legacy and
task-runtime stores remain independently registered.

The AW2-10 host will record a decision before reserving/dispatching an attempt,
link its reference into global task history, and recheck current authority and
availability. A successful selection alone neither starts an agent nor grants it
access to customer data.

## Verification

Tests cover privacy overriding score, provider/actor availability, policy,
information flow, resource access, budget limits and unknown costs, currency,
invalid/valid pins, deterministic ties and candidate permutation, capability and
rule constraints, trust/residency, latency, malformed input, detached snapshots,
decision integrity and SQLite persistence/replay.

```bash
npm run test --workspace @agent-world/capabilities
npm run test --workspace @agent-world/routing
npm run test --workspace @agent-world/runtime-store-sqlite
```
