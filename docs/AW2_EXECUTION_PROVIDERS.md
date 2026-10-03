# AW2-2 — Execution provider contract and registry

`packages/execution-providers` defines a provider-independent boundary:
`probe`, `listActors`, `prepare`, `dispatch`, `observe`, with optional messaging,
cancellation and reconciliation. The contract carries global task/work-unit/
attempt IDs, stable dispatch identity, scoped context/resource references and a
host authorization reference. It grants no authority by itself.

Provider references remain distinct from global IDs. Reported success is named
`reported-success`; it is evidence for verification, not global completion.
Observations preserve running, reported failure, exited, unknown, unverifiable,
timeout and not-found. A dispatch timeout is deliberately not a proven failure
or permission to dispatch again. Production adapters must normalize responses
without erasing these distinctions.

## Registry behavior

- Providers begin unavailable until probed.
- Refresh excludes previous actor candidates while probing.
- Metadata is validated before it becomes a registry snapshot.
- Unavailable or degraded providers/actors are excluded from automatic candidates.
- Failed/malformed/hung probes fail closed, with bounded wait and stable reason codes.
- Unregistering or a newer refresh prevents a late response from restoring stale actors.
- Actor IDs are globally unique; conflicts cannot overwrite another provider.
- Returned metadata is detached; callers cannot change registry state through it.

This registry is discovery infrastructure, not the AW2-4 capability router or an
authorization engine. `get()` exposes a provider to a trusted host; a registry
candidate is not authorization to execute. AW2-10 must enforce policy, scope,
leases, budgets and effect safety before dispatch. Probe deadlines cannot forcibly
cancel an uncooperative provider's read-only Promise; transport adapters need their
own bounded subprocess/network calls.

## Test double and lifecycle acceptance

`src/testing.ts` contains an explicitly named `MockExecutionProvider`. It is not
exported by the default production barrel and is never installed automatically.
It runs no commands, creates no terminal/worktree and performs no external effects.
Its dispatch checks prepared identity and returns the same receipt for duplicates.

Tests drive a global WorkUnit through prepare/dispatch/observe, retain the unit in
verification after provider-reported success, then submit explicit test-host
verification/evidence and complete the goal. This proves the contract composes
with AW2-1; it does not claim a production verifier, real Orca or a governed
end-to-end dispatch loop.

Additional tests cover unavailable/degraded filtering, malformed data, exceptions,
timeouts, unregister/race behavior, global actor collisions, scope mismatch,
idempotency and distinct uncertainty observations.

## Next milestone

AW2-3 implements a real Orca CLI adapter, probes supported JSON command paths and
fails unavailable when the app/launcher cannot operate. Fake success is forbidden.
Live provider execution remains opt-in and must not run paid/cloud work by default.
