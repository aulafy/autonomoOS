# C4 — BudgetLedger and reservations

`@agent-world/budgets` accounts for capacity; it never grants authority. A caller needs a separate authority decision before any action. Budget dimensions are independent strings such as `money:EUR:minor`, `api_calls`, and `gpu_ms`. Quantities are serialized as nonnegative integer strings and calculated with `BigInt`. No floating-point money arithmetic or currency conversion occurs.

For every account and dimension, `reserved + consumed <= ceiling`. A reservation atomically moves capacity from available to reserved. Commit moves actual usage (at most the reserved amount) to consumed and returns the unused portion to available. Release returns all reserved capacity. Repeating a commit with the same actual amount or repeating a release is idempotent. Frozen accounts refuse new reservations but can settle existing ones. A child budget reserves its entire ceiling in the parent and settles its actual consumption when closed.

Reservation expiry is detected at `now >= expiresAt`. Cleanup is explicit through `expireReservation`; there is no timer or daemon. A later effect state such as `UNKNOWN` may require keeping a reservation held after its TTL, so the caller must apply that policy before invoking cleanup. `effectId` is only an optional reference in C4; no EffectTransaction exists here.

The in-memory ledger is atomic only within one process. Durable storage will need transactional updates of the account and reservation together. C4 does not modify the M5 runtime and does not implement C5 Observation or C6 EffectTransaction.
