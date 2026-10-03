# Runtime interface integration

The PYMES Centre of Agents screen is currently an explicitly labelled fixture
preview. It does not fetch a live runtime or claim that its example jobs are real.

`readRuntimeWorkspace` in `@agent-world/task-runtime` is the host-side DTO builder
for connecting the interface to a real kernel snapshot. It filters tasks by the
owner principal derived from authenticated server identity (never query input),
allows an optional task selection, and bounds the task list to 1–100 entries.

The DTO contains task status, work-unit counts and dependency IDs, actor/provider
identity, provider-reported outcome, and verification history with evidence refs.
Provider report never increments verified success. UNKNOWN remains explicit.
Commands, objective/context bodies, criteria arguments, opaque provider refs,
dispatch fingerprints, permissions and message bodies are excluded. Goal/title
text is visible only to the matching task owner; host input classification remains
responsible for what is stored in these fields.

Snapshots and returned verification history are detached. Owner matching is an
initial conservative boundary, not a complete tenant or delegated sharing model.
The authenticated endpoint, tenant-to-principal mapping, client schema validation,
refresh/error handling, and replacement of example data are still pending.

## Authenticated PYMES endpoint

`WorkspaceApi` accepts an optional host `WorkspaceRuntimeSource`, which selects a
tenant-isolated snapshot and maps authenticated workspace principals to runtime
owner principals. `GET /v1/workspaces/:tenant/runtime` returns the read model;
`GET /v1/workspaces/:tenant/runtime/:task` filters one owned task. The existing HTTP
adapter provides no-store/security/CORS headers and hides server exceptions.

Session validity, tenant and the new `readRuntime` permission are checked before
snapshot access. Owner, agent and reviewer roles have this permission; effect
worker sessions do not. Runtime ownership still filters all results. Unconfigured
sources return 404 `RUNTIME_NOT_CONFIGURED`, never example data. Foreign and missing
task IDs both return an empty list to avoid identifying another owner's task.

Tests cover valid HTTP reads, no private criterion bodies, missing authentication,
foreign tenants, worker denial, same-tenant other-owner isolation and absent runtime.
Startup currently has no source injected: attaching the durable per-tenant kernel
and mapping identities remains required before the frontend can show live jobs.

## Persistent startup source

PYMES API startup now opens `PYMES_RUNTIME_DB_PATH` (default
`./data/pymes-task-runtime.db`) and injects its source into `WorkspaceApi`. The
journal registers the task runtime and an immutable tenant binding before replay;
all state and the binding use H1's authoritative SQLite command log. An existing
unbound journal or a different tenant fails startup. Restore drift is never
replaced by empty state. The source maps session user IDs to runtime owner IDs
within that tenant; integrations creating tasks must use that same identity.

The database is closed with the workspace repository on shutdown. A new database
has zero tasks and contains no seeded client data. Persisted tasks are visible over
the authenticated runtime endpoint after reopen. Other tenant snapshots return
null, and closed sources reject access. Host orchestration/task creation and the
live UI client remain pending.

## Browser client

`WorkspaceClient.runtimeView()` now uses the existing authenticated, timeout/size
bounded HTTP request path. `parseRuntimeView` validates tenant, schema version,
revision, statuses, task/unit/attempt structure, dependencies, unit counts and
verification/evidence reference shapes before returning detached data. Empty live
state is retained. The interface renderer and session lifecycle refresh binding
are the next integration step; the screen still explicitly displays demo fixtures.

## Live screen integration

The Centre of Agents now receives the existing WorkspaceClient from session setup.
Connected sessions fetch real runtime state and render task selection, unit status,
dependencies, actor/provider reports and verification rounds/evidence references.
Refresh and screen entry requery the endpoint. Generation guards discard results
from prior sessions. Errors clear displayed live data; no fixture substitution is
used for configured workspaces. Missing sessions and connection failure show an
explicit unavailable state. Unconfigured preview remains labelled demonstration.
The view is read-only. Automatic task creation and actor execution remain pending.

## Login and browser acceptance

Settings now offers service URL, workspace and session-key inputs. It verifies an
authenticated inbox request before storing the key in this tab's sessionStorage,
then navigates to the connected runtime view. Keys are cleared from the field on
success/failure and never put in the URL. This is the existing appliance session
mechanism; account login/provisioning and credential rotation are separate work.

Actual in-app browser acceptance used an isolated localhost API on port 8899 and a
synthetic QA task persisted in `/tmp/aw2-browser-qa-20261003/live-runtime.db`.
Login, the persisted task display, and refresh passed. The task remained Created
with no plan or verification, accurately matching stored state. This exposed and
fixed unbound native fetch invocation and missing Cache-Control in the CORS
preflight allowlist. Screenshot: `/tmp/pymes-runtime-live.jpg`.
No client data or real provider action was used in this browser check.

## User-created task intake

Connected users can now submit a bounded goal to `POST /v1/workspaces/:tenant/runtime`.
The new createRuntimeTask permission is limited to owner/agent roles. The server
rejects extra authority/owner fields and selects the owner from the authenticated
session. The host creates a persisted GlobalTask with a final human-review criterion
for that owner. This criterion describes required future approval; creation never
marks it satisfied and grants no actor authority. Planning and execution are pending.

A caller-generated UUID is retained for manual retry of the same objective. Exact
repetition returns the existing task; conflicting reuse returns 409. Browser QA
created a synthetic renewal task through the form and confirmed revision 2 and its
Created status in the real SQLite-backed view. Tests verify durable reopen, duplicate
handling, conflicting objectives, owner-field injection and worker denial.
