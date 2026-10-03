# AW2-7 — Evidence ledger and verification (in progress)

## Implemented evidence foundation

`@agent-world/evidence-ledger` persists EvidenceRecords with global scope, claim,
typed source, strength, payload/artifact references, observer, provenance and time.
Records are immutable, exact duplicate append is idempotent and reads are detached.
Task/attempt/criterion queries retain conflicting records rather than overwriting
an agent's claim with a later observation.

Three strengths remain distinct: claim, observed and independently-verified.
A provider report must be a claim. An observation or human approval cannot become
independently-verified by changing its strength: promotion needs a verifier result
with criterion identity and observation references. Verifier evidence requires an
exact WorkUnit/Attempt scope. Those structural checks do not authenticate an
observation or validate actual human authority. The trusted governed collector and
verifier registry must perform those checks; model-supplied records are not proof.

`createDurableEvidenceLedger` registers `aw2EvidenceLedger` with the H1 journal
before restore. Closing/reopening SQLite restores both an original provider claim
and separately recorded contradictory evidence, including their different strengths.
That test validates storage, not execution of an independent verifier.

## Remaining milestone requirements

- Verification lifecycle integration with the global kernel and durable evidence.
- Host configuration for actual test commands, file reads, HTTP, schema artifacts
  and authenticated approvals through configured governed actions/observers.
- Acceptance: worker reports success, independent test fails, WorkUnit remains
  non-succeeded and contradictory evidence survives.
- Acceptance: all independent required criteria are satisfied, WorkUnit succeeds.

No test command, file read or HTTP verification may bypass the existing governed
action/observation path. A missing collector, timeout, stale observation or ambiguous
effect must produce UNKNOWN, not successful verification or a blind retry.

```bash
npm run test --workspace @agent-world/evidence-ledger
npm run test --workspace @agent-world/runtime-store-sqlite
```

## Implemented verifier and collector boundary

`@agent-world/verification` registers deterministic test, file, JSON schema, HTTP,
observation and human-approval verifiers. Each input binds Task/WorkUnit/Attempt,
criterion and observation freshness. A missing/ambiguous verifier, wrong scope,
stale proof, unsupported assertion or malformed payload produces UNKNOWN. Valid
observations retained by an inconclusive evaluation keep their references.

Test checks exact command/cwd and exit code. File v1 supports exists, contains and
SHA-256 digest; unsupported assertion keys are UNKNOWN. HTTP checks exact method
and resource, optional status and a contains body assertion. Observation v1 supports
an own-property path and exact JSON equality, rejecting prototype paths. Human
approval requires exact principal/task/unit/attempt, approval identity, boolean
decision and an unexpired validity window from a trusted observer.

JSON schema uses Ajv's strict default dialect, in a separate worker with a 1-second
deadline and 32/8 MB old/young generation limits. Schema/data inputs are bounded,
validation does not coerce values or remove fields, and no remote schema loader or
asynchronous schema is enabled. Unsupported keywords/formats/dialects and missing
external references become UNKNOWN. See [Ajv options](https://ajv.js.org/options.html).
The worker deadline also isolates regex evaluation; unsupported dialects remain
UNKNOWN rather than being interpreted with a different schema language.

`GovernedVerificationCollector` calls the existing runner's admit/dispatch path.
A trusted host supplies the configured action plan and observer-specific decoder.
The request must match the task, stable collection correlation ID and criterion
digest. Results bind effect, intent, resource, observation IDs, observer allowlist,
authenticated strong independent descriptor and confirmed/contradicted status.
Provider/fixture sources and self-observation cannot become independent proof.
Raw observations are fetched from ObservationStore, not passed in by an actor.

`VerificationCollectionStore` claims the job before admission and stores effect
identity before dispatch. Its H1 adapter registers `aw2VerificationCollections`.
Repeated calls return the saved result; unfinished or unknown jobs never start a
new action. Reopening SQLite preserves a claim and prepared effect identity.
AW2-9 will reconcile unresolved jobs; admission denial is conservatively held as
UNKNOWN until explicit recovery. Freshness still applies to saved observations:
an expired result cannot trigger an automatic new command.

Tests execute the actual C12 runner against disposable test world/observer fixtures
and verify permission revocation, independent contradiction, observer error,
cache reuse and uncertainty. They do not demonstrate a live test-command executor,
production HTTP request or full global verification lifecycle yet.

## Host lifecycle bridge (2026-10-03)

`AttemptVerificationService` evaluates every criterion of the active reported
attempt through the host registry, appends each outcome to the evidence ledger,
registers scoped evidence references, and submits `VerificationCompleted` to the
kernel. Provider success remains a report; failed checks produce a failed work
unit and unavailable checks preserve UNKNOWN. Global task completion requires its
separate task-level verification and is never inferred by this bridge.

Unavailable verification without observations uses an explicit
`verification-unavailable` host record, with observed strength; no observation or
independent success is fabricated. Storage failure leaves the attempt verifying.
The bridge does not automatically rerun interrupted checks. Durable recovery and
cross-store coordination remain AW2-9 work; concrete production observer/executor
configuration and the live UI endpoint remain pending. Tests here use controlled
verifier outcomes to prove lifecycle handling, not real command execution.

### Verifier deadlines and cancellation

The registry bounds each verifier to 30 seconds by default (host-configurable up
to 60 seconds), passes a cancellation signal, and returns UNKNOWN on timeout or
caller cancellation. An already aborted request invokes no verifier. Late results
cannot promote the result to success. Cancellation is cooperative: an implementation
that ignores the signal may continue its work; the registry does not retry it.
Duplicate observation references and invalid/oversized reasons fail closed before
any lifecycle promotion. Four regression tests exercise these boundary cases.

### Global verification outcomes

The task kernel now accepts `GlobalTaskVerificationCompleted` after all work units
succeed, and stores the full task-level verification result. Satisfied criteria
complete the task; any UNKNOWN preserves UNKNOWN, otherwise a failed criterion
blocks the task. Unit success is retained and cannot override the global outcome.
Missing evidence and unfinished units reject the event atomically. The legacy
`GlobalTaskCompleted` event continues to require satisfied criteria exclusively.
Production task-level collection/orchestration and recovery of blocked/unknown
global checks are still pending; this event grants no execution authority.

### Reverification after explicit reconciliation

Verification event/evidence IDs now include a round derived from the kernel's
existing completed-verification history. A reconciled UNKNOWN attempt can start a
new round without conflicting with its first start/finish event or overwriting its
evidence. New service instances derive the same next round from persisted history.
A round still requires `reported` state; this does not permit rerunning an unresolved
`verifying` attempt or redispatching a worker. Collection reconciliation remains
necessary for an unresolved durable collection claim; cached uncertainty is not
silently bypassed. Two regression tests cover new evidence and repeated UNKNOWN.

### Real filesystem observation adapter

`decodeFilesystemVerification` converts the existing H2 independent filesystem
observer's evidence to AW2 file verifier payloads. It binds the task, canonical
resource, postcondition hash and actual digest evidence; ambiguous or mismatched
evidence is rejected. SHA-256 digest and existence are supported without exposing
file content. Content assertions remain UNKNOWN until a governed content observer
is configured. The adapter executes no filesystem reads and must be used behind
`GovernedVerificationCollector` for effect/intent/observer authorization checks.

An integration test reads a disposable real file through `FilesystemObserver`,
verifies its digest, detects changed bytes, handles absence, and rejects scope,
postcondition and duplicate evidence mismatches. The test collector is a controlled
adapter harness; a production C12 action configuration remains pending.

### Governed real-file acceptance

Two end-to-end integration scenarios now connect the actual C12 runner, authority
lease, contract, budget, resource lease, FilesystemReadExecutor, independent
FilesystemObserver, governed collector, deterministic file verifier, evidence
ledger and task kernel. Both start with worker-reported success. Expected real
bytes yield a succeeded unit; different real bytes yield a failed unit with
unsatisfied evidence. C12 commit permission is asserted in both scenarios.

The host authorities and stores in these acceptance tests are configured in memory
and files are disposable. This verifies the full governed path without claiming
that the production appliance API or UI has been configured. Existing observer
policy generation validation is enabled against the real file resource registry.

### Production filesystem verifier configuration

`createFilesystemVerifier` provides the reusable host configuration for canonical
file resources. Explicit bindings include task/unit/attempt/resource identity and
existing principal, contract, authority and optional resource lease references.
The factory grants no authority; C12 validates live permissions before dispatch.
Bindings are cloned, duplicates and noncanonical file resources rejected, and
stable collection-specific intent IDs avoid cross-criterion identity reuse.
Supported assertions are validated before admission (existence and SHA-256).
Unbound work and unsupported content assertions cause UNKNOWN with zero reads.
The governed real-file acceptance tests now use this exported production factory.
Appliance startup registration, durable configuration and UI/API remain pending.
