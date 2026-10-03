# AW2-5 — Context engine

`@agent-world/context-engine` builds one immutable, versioned ContextEnvelope for
one Task/WorkUnit/Attempt and an explicit actor/sink. The goal and work objective
are labelled source references too: customer data in instructions has the same
information-flow checks as facts and artifacts.

## Trusted inputs and minimum context

The host source catalog binds each content value to an authoritative C9 data
object and declares its task, intended WorkUnits, kind, category and locality.
That binding is trusted host code; labels and scope supplied by an agent are not
authority. Inclusion requires an explicit required/optional reference, exact
task/WorkUnit relevance, host policy permission and C9 flow acceptance. An actor
receives the requested prior decisions/artifacts/evidence, rather than a whole
transcript or unrelated email history.

Missing or denied required context fails construction. Unrequested, unrelated,
policy-denied, unknown-labelled, raw credential and local-only-to-cloud sources
are explicitly excluded. Optional confidential material needing release approval
is omitted when no approval was supplied. Required confidential material needs an
exact C9 approval, matching the final aggregate object set, sink, intent, working
set version and validity window. A denial cannot be overridden by approval.

The sink must be host-registered with actor ID, provider ID and locality metadata.
A remote actor cannot use a local sink to bypass C9 restrictions. Actor metadata
is validated through the provider boundary. This package calls the existing C9
FlowEngine; it does not implement a second confidentiality policy. The host's
authorize callback supplies the current action/resource/composition policy at the
captured policy reference; AW2-10 connects it to governed execution.

## Provenance, permissions and rendering

Included sources retain data object identity, origin, label, lineage and content
digest. Envelopes separate facts, decisions, artifacts, evidence, constraints and
permissions and record exclusion categories/reasons without excluded content.
Raw credentials are never context, including for local agents. Permission entries
are constrained references with resource, actions, authorization reference and
expiry; extra secret fields are rejected. These entries do not grant execution
authority or replace leases, fencing, budget or effect checks.

Rendering rechecks the target binding, C9 working-set version, current host policy,
release approval and permission expiry. It reconstructs all partitions from the
current catalog and compares them with the recorded envelope. Rehashing an
invented facts array cannot bypass source provenance. Source/policy changes require
a new envelope. A later evaluation clock is permitted while preserving the original
audit timestamp; expired authorization is still rejected.

Orca rendering produces a scoped work specification containing JSON data and an
explicit data/authority boundary. Local model and generic provider renderers emit
JSON. They omit excluded content, host policy records and the source catalog. This
is context rendering, not provider execution. AW2-10 will connect authorized
rendered context to Orca's placement resolver and other provider adapters.

## Versions and durability

Build output is deeply frozen. SHA-256 IDs bind the full canonical envelope.
ContextEnvelopeStore accepts monotonically increasing versions linked to the
previous envelope within the same attempt. Historical versions stay intact and
reads are detached. `createDurableContextStore` registers `aw2ContextEnvelopes` on
H1 before restore, preserving context/provenance after closing and reopening
SQLite. A saved envelope is an audit snapshot, not a reusable permission grant:
rendering always revalidates current authorization.

## Tests

Focused tests cover required decisions/artifacts, provenance, unrelated content,
forbidden categories, local-only data, required omissions, protected goals,
immutability/version chains, stale working sets, policy/source changes, forged
partitions, credentials, target binding, exact release approvals and expiry,
permission schema/expiry, later clocks and optional confidential exclusions.
SQLite integration verifies both envelope versions and provenance survive restore
and that a restored snapshot cannot bypass revoked policy.

```bash
npm run test --workspace @agent-world/context-engine
npm run test --workspace @agent-world/runtime-store-sqlite
```
