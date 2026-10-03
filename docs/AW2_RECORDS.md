# AW2-6 — Decision ledger and artifact registry

`@agent-world/decision-ledger` records questions, choices, rationale, actor and
descriptive authority, evidence references, provenance, timestamps and explicit
supersession. Authority and evidence references in a record are not execution
permission or verified evidence: the governed host must validate their meaning.

## Append-only decisions

Record identity is immutable. Exact duplicate append is idempotent; changed content
under an existing ID is rejected. Reads are detached. A replacement references the
current leaf through `supersedes`, with the same task, WorkUnit scope and question
and a nondecreasing timestamp. Branching from an already replaced decision, cross
scope replacement and time regression are rejected before mutation. Creating a
second current answer to the same scoped question requires explicit supersession.

`get` and `history` preserve old records. `resolveCurrent(oldId)` follows the
append-only chain to its current leaf. `current(taskId, workUnitId?)` returns current
records in that exact scope; an omitted WorkUnit selects task-level decisions.
Independent question scopes are not silently merged or overridden.

## Artifacts

`@agent-world/artifacts` stores immutable ArtifactRecords with task/WorkUnit scope,
kind, URI, optional SHA-256 content digest/media type, creator and provenance. Its
append receipt separately hashes the metadata record; this is distinct from the
artifact content digest. A content digest may be absent for an unverified reference.
Recording a claimed digest never proves that a file currently has that content;
independent verification is AW2-7.

The registry performs no URI fetching, filesystem read or file creation. It accepts
resource/artifact/file/HTTPS references, rejects embedded URI credentials and
unknown metadata fields, and exposes no generic secret metadata bag. Secrets must
remain in the appropriate governed credential/resource system. Record schemas have
explicit fields and provenance references, with no raw credential attributes.

## Labelled downstream handoff

`ledgerContextSources` resolves requested decision aliases to the current record
and loads requested artifacts in the same task. It sends the current record ID and
metadata digest to a trusted host binding callback, which must bind those exact
bytes to a classified C9 data object. It marks only the explicitly targeted
downstream WorkUnit as relevant. The adapter neither guesses labels nor grants
release permission. ContextEngine then applies normal policy, locality and C9
flow checks to the resulting sources.

Source IDs retain the logical requested alias while the value identifies the
current decision. A new decision changes the source digest; an old ContextEnvelope
must be rebuilt before delivery rather than silently rendering a different choice.
The host must refresh classifications and source bindings for changed records.

## H1 durability

`createDurableRecordStores` registers `aw2DecisionLedger` and `aw2ArtifactRegistry`
before journal restore. Mutation receipts include metadata digests, and replay
reconstructs the original records and supersession index. A fresh-process SIGKILL
test verifies history, current decision, artifact content digest and provenance
survive abrupt termination. This reuses the existing journal; it creates no second
global source of truth or provider-owned decision authority.

## Tests

Tests cover immutable/idempotent decisions, supersession history/current lookup,
invalid branching/scope/time, schema/provenance validation, preserved artifact
digests/provenance, optional unverified digests, URI credentials/metadata rejection,
current decision handoff, cross-task handoff rejection and real SIGKILL recovery.

```bash
npm run test --workspace @agent-world/decision-ledger
npm run test --workspace @agent-world/artifacts
npm run test --workspace @agent-world/context-engine
npm run test --workspace @agent-world/runtime-store-sqlite
```

AW2-10 will connect records to task references and governed host decisions. These
stores do not themselves execute actions, confirm artifact contents or complete a
WorkUnit.
