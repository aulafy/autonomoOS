# H1 Durable Runtime

## Authority and startup

The default M5 agent runtime opens one SQLite database at
`AGENT_WORLD_DB_PATH` (default: repository `data/agent-world-os.db`, resolved
from the runtime source location). SQLite is authoritative for control state and
runtime events. A corrupt or incompatible database prevents startup; there is
no in-memory fallback. The WebSocket server starts only after migration,
integrity checking and projection restoration succeed.

The existing `JsonlEventStore` remains available to read old JSONL files.
`RuntimeDatabase.exportRuntimeEventsJsonl(path)` writes a snapshot of SQLite
events in that same line-delimited format. Live WebSocket replay reads SQLite.
JSONL is an export/debug format, not a second live writer.

## Schema and reconstruction

Schema version 1 has numbered `schema_migrations`, ordered `store_commands`,
ordered `runtime_events`, and `projection_digests`. The database uses WAL,
`synchronous=FULL`, foreign keys and an integrity check. Commands record the
store, method, serialized arguments, operation time and result digest. The
existing C1–C12 domain classes perform validation and transitions; SQLite
does not implement policy. On startup, `JournalKernel.restore()` replays all
commands into fresh domain stores at their recorded times and compares each
result digest and each store's final chained digest. A mismatch stops startup.

Durable projections cover resources and generations, grants and revocation,
contracts, authority and resource leases and fencing, budget accounts and
reservations, observations, effects and effect events, reconciliation jobs and
decisions, C8 history and approvals, C9 objects/lineage/working sets/sinks and
release approvals, emergency stop, quarantine, and task status/required
effects. Runtime events, including recovery events, are in the same database.

## Transaction boundaries

- Admission PREPARE: budget reservation, effect creation/preparation, effect
  provenance and control event commit in one SQLite transaction.
- Dispatch marker: effect transition to `dispatching`, history fact and control
  event commit in one transaction. Only then may the executor be called.
- Observation: the observer runs outside SQLite. A validated observation is
  appended durably. Effect settlement, budget consumption and C8 fact capture
  then commit together. A crash between observation and settlement is repaired
  by C12 from the durable observation.
- Recovery performs local bookkeeping and schedules read-only reconciliation.
  It never calls a side-effect executor. A held reservation can be consumed
  after its TTL only when an already committed effect provides the receipt;
  ordinary `commitReservation` still rejects expiry.

SQLite transactions do not encompass the external world. A persisted
`dispatching` marker with no conclusive durable observation becomes `UNKNOWN`
after restart and retains its budget hold. PREPARING/PREPARED are cleaned up;
COMMITTED is never re-executed. The task completion record is persisted after
the acceptance check. Restart cannot grant authority: current grant version,
revocation/expiry, lease and fence are checked by the existing commit gate.

## Verification

Tests reopen all critical domain stores, verify monotonic fencing and budget
conservation, compare reconstructed projections, detect a corrupt digest,
check revoked grants, and exercise real child-process `SIGKILL` windows A–H.
An integrated C11 test kills the process after the dispatch marker and before
the M5 world executor, then reopens SQLite in a fresh process and verifies
`UNKNOWN`, held budget, one reconciliation job and no world action.

## Current limits

- The M5 Three.js world is still an in-process demo. SQLite preserves control
  facts and events; it does not reconstruct every world entity from events.
- The command log uses Node's `v8` serialization. Database files should be
  treated as local runtime state tied to this application/Node line; a future
  cross-version export format needs a numbered migration.
- A validated observation and its subsequent settlement have separate durable
  boundaries by design, with C12 repair between them. The observer or provider
  is never part of a SQLite transaction.
- H1.1 schedules live WebSocket notification after the outer SQLite commit.
  A crash after commit but before delivery leaves the event in replay.
- The existing demo observer is same-process evidence, and the local
  `llama.cpp` provider still depends on a separately running service. H1 does
  not add an external executor or inference integration.
