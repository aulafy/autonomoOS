# AW2-3 — Orca execution provider

## Verified local interfaces

The installed application is `/Applications/Orca.app`. Its public launcher at
`/Applications/Orca.app/Contents/Resources/bin/orca` successfully executes
`status --json`. The `/usr/local/bin/orca` link cannot resolve the app and should
not be used by this installation. No system link was changed.

The public status envelope is `{ ok, result, ... }`. Status data lives under
`result.runtime`, with `reachable`, `state`, optional `appVersion` and
`capabilities`; it does not expose capabilities at the result root. The first observed runtime was `not_running`, with `reachable: false`. A later
real probe found it available at version `1.4.218`, with the required supervised
contract capability. Availability is a current observation, not a persistent
guarantee. No worker was launched.

The installed CLI handlers confirm public commands for `run-create`,
`worker-start`, `worker-show --dispatch`, inbox/check and reply. Mutation commands
accept `--retry-request` with a UUID. Its semantics recover the original mutation
identity rather than minting a fresh operation. Worker startup returns provider
`dispatchId`, `taskId` and `state`; incomplete startup may have residual effects.
These facts guide the adapter; the package never links to Orca internal modules.

## Implemented foundation

`packages/provider-orca/src/cli-transport.ts` invokes an explicitly configured
absolute executable with an argument array and `shell: false`. It bounds duration
and captured output, distinguishes startup failure, timeout, termination and
output overflow, and avoids printing provider stderr or raw exceptions. Environment
inheritance is restricted to basic OS variables; credentials are not injected.
On POSIX, timeout escalation targets the process group even if the launcher exits
before a descendant that ignores SIGTERM. A subprocess fixture verifies this case.

`decoder-v1.ts` isolates the observed public JSON envelope and nested status shape.
Unreachable runtime, missing supervised contract capability, malformed JSON and
unexpected response shapes cannot become availability success.

```bash
npm run probe --workspace @agent-world/provider-orca
```

Set `AWOS_ORCA_EXECUTABLE` to an explicit absolute launcher path if different.
The probe performs no mutation and exits nonzero when unavailable. An opt-in
`AWOS_LIVE_ORCA=1` test expects a running, compatible runtime; default tests use a
fake executable fixture and do not start paid/cloud workers.

## Provider boundary and integration limits

The ExecutionProvider now implements prepare, dispatch, exact worker observation
and observation-based reconciliation, scoped message reception, durable replies
and read-only receipt recovery. A trusted host supplies configured actors,
authorization checks and a scoped placement/context resolver. Dispatch authority
must come from the governed host. The AW2-10 host will bridge provider signals,
global events, policy, leases/budgets and independent verification. No worker was
launched against real Orca: fixture execution proves adapter behavior, not a live
coding-agent execution or a production end-to-end governed task.


## Durable dispatch implementation

`OrcaAttemptStore` is a private provider-local SQLite recovery cache, not global
lifecycle truth. It stores the authorized prepare request/placement, deterministic
UUIDs for run-create and worker-start, state and exact receipt references. Global
attempts remain in AW2's H1 journal. The database uses WAL/FULL, a unique attempt
identity and an atomic compare-and-set claim before the first provider mutation.

Preparation does not launch a worker. Dispatch rechecks host authorization and
availability. Commands use explicit coordinator, authorized worktree and agent;
no focused terminal or broad repository is inferred. The task specification adds
only global task/unit/attempt metadata to host-resolved scoped instructions.

Successful receipts reopen without another CLI mutation. Timeout, incomplete
startup or malformed mutation response become UNKNOWN, including any references
already obtained. Repeated dispatch of UNKNOWN only returns reconciliation-required;
it does not run the commands again. Proving a provider-local request absent is
not proof of non-execution and must never automatically authorize a retry.

Observation requires references matching the persisted attempt and the response's
exact dispatch/task identities. A worker's settled success is reported-success,
not a completed global WorkUnit. Worker failure remains reported-failure; uncertain
or unverifiable liveness remains uncertain. A terminal's existence is insufficient.

## Lost mutation receipts

`recoverDispatch` checks the saved global scope and host authorization, then uses
`orchestration request-show` with the original request UUID. The installed public
response includes a `receipt` object whose `mutation.requestId` binds it to that
request. Recovery checks request ID, method, completed state and receipt ID, then
decodes the recorded result. It invokes no mutation command. If both run and worker
references were lost, it recovers both recorded receipts in order. It never starts
a missing worker after recovering only a run.

Absent, pending, unsupported, malformed or mismatched receipts remain UNKNOWN.
Partial startup may recover references, but does not become dispatched unless the
recorded worker startup state is ready. Same-request replay is supported by Orca,
but this adapter does not need to replay mutations to inspect completed receipts.

## Questions, escalation and completion reports

`receive` reads the exact Dispatch and the bounded Run inbox without acknowledging
or consuming provider messages. It checks Run/Task/Dispatch identity, recipient
mailbox and the exact assignee or Dispatch sender. Other runs, attempts and senders
are ignored. Malformed scoped messages and conflicting reuse of a message ID fail
closed. Provider-local SQLite stores the normalized signals and their original
observation timestamps, so repeated reads and restarts preserve their identity.
The inbox is bounded to 1,000 messages; this is not a guarantee of complete mailbox
history. Transport output limits also apply. The host must not infer absence from
an empty, bounded or unverifiable read.

`worker_done` becomes reported-success/reported-failure only. A question or
escalation never reconciles an UNKNOWN attempt or completes a WorkUnit. The global
kernel accepts `ProviderQuestionReceived` / `ProviderEscalationReceived`, storing
provider message identity and a content reference on the H1 journal. These fields
are introduced lazily to preserve the projection digest of historical AW2 events.
The SIGKILL integration test proves those global records survive a fresh process.

`send` supports answers to previously observed questions. It requires a separate
`authorizeMessage` host callback for the answer's content/information flow,
rechecks authorization immediately before claiming the reply, and requires exact
fleet liveness. It persists the original question, answer and deterministic
request UUID before invoking `orchestration reply`. One atomic claim per question
prevents competing answers. Repeated identical replies return their durable
receipt; conflicting answers are rejected. Ambiguous outcomes preserve UNKNOWN
and `recoverSend` inspects the recorded reply receipt without sending another answer.
This adapter API is not permission for the runtime to answer a human's questions
automatically; policy and host decision records supply that authority in AW2-10.

## Verification

Fake executable integration tests cover dispatch/reopen, authorization revocation,
probe timeout, timeout after possible mutation, malformed/incomplete startup,
failure/unknown/stale observations, competing dispatch claims, both lost provider
references, completed/pending/absent/mismatched receipt recovery, completion reports,
question/escalation filtering, durable answer identity, lost answer recovery,
answer-content authorization, conflicting messages and stale fleet projection.
These tests perform no coding-agent or cloud execution. The opt-in live check
performs status only; live coding execution remains an explicit later acceptance
step against a disposable authorized repository.
