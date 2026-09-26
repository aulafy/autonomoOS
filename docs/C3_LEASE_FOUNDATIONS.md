# C3 — AuthorityLease and ResourceLease foundations

`@agent-world/leases` does not issue authority grants. A trusted control-plane caller supplies an `AuthoritySource` read-only view. `AuthorityLeaseService` refuses missing, revoked, expired or widened grants and records the grant version. `AuthorityLeaseValidator` fetches both the lease and grant again for every live decision; possession of an old lease object does not override current state.

`ResourceLease` is a separate exclusive mutation slot. The in-memory store allocates a strictly increasing fencing token for each resource on every new acquisition. Renewal of the same live lease retains its token. `LeaseCommitGate` requires a valid AuthorityLease and, when requested, a current ResourceLease with the expected fence. The gate performs no side effect; a later executor must check the fence atomically at the actual mutation boundary.

The stores are in-memory foundations. A process restart loses leases and fencing counters; a durable store with transactional fence allocation is required before restart-safe or distributed execution. C3 is not connected to the M5 runtime. C4 BudgetLedger and later control-plane stages remain separate.
