# Next work after H4

The verified baseline is C1–C12 and H1–H4. The immediate product question is
which complete human or business workflow should be supported end to end.
Choose one workflow and define its authority owner, resource boundaries,
acceptance evidence, failure recovery, and user review points before adding a
general capability.

Near-term engineering work:

1. Harden Astra's new operator console with cursor-paginated journal reads,
   task filtering, and explicit status for long-running unknown effects. Indexed
   bounded journal reads are implemented. The
   current panel reads proposal, admission, denials, effect status, observation,
   budget settlement, and reconciliation from durable stores.
2. Add authenticated control-plane access and an operator review surface before
   exposing the runtime beyond loopback.
3. Evaluate the first real provider integration for idempotency, reliable
   lookup, credentials, sensitive data flow, and ambiguous failure behavior.
4. Measure correctness and recovery across crashes, timeouts, malformed
   provider responses, and conflicting observations.

H5 browser/computer use is intentionally deferred until a concrete workflow
needs it and its authority and observation boundaries are specified.
