# H4: restricted HTTP/API effects

H4 adds one consequential network action, `api.create_record`. A model can propose
`{name, value}` for a host-selected endpoint. It cannot supply a URL, method,
path, header, credential, grant, or data-release label. The repository and its
tests are the implementation authority.

## Authority and resource model

The host registers `service:demo-api` and
`endpoint:demo-api/items-create` in C2, with a binding hash, fixed `POST
/items`, fixed `GET /items/by-idempotency-key/:key`, strict Zod schemas,
credential reference, external sink classification, and idempotency/lookup
capabilities. The action registry maps `api.create_record` to this endpoint.
The H3 goal service accepts this semantic proposal only for the target selected
by the caller, and verifies its parameters against the caller's expected record.

C1 grants and leases, C4 network-byte/tool reservations, C8 composition
policy, C9 information flow, C10 emergency stop/quarantine, and C11 admission
apply before dispatch. The caller supplies the expected record as a trusted
public DataObject; model text is not promoted to a releasable label. A secret
DataObject is denied by C9 even when send authority exists. H4 reserves the
outgoing JSON body bytes; response bytes are bounded and recorded in executor
metadata but are not charged to C4.

## Destination and credential boundary

The executor receives only an authorized canonical endpoint ID. The host
configuration chooses the origin. Production bindings require HTTPS and a
resolved public IPv4 address; private, loopback, link-local, metadata,
special-purpose, and all IPv6 addresses are denied. Every resolved address is
checked, and the selected address is pinned for that request. Only explicit
fixture registration permits HTTP loopback. The client uses fixed methods and
paths, caps request and response bodies at 64 KiB, sets a timeout, and never
follows redirects. A 3xx after possible dispatch remains uncertain.

The opaque `credentialRef` is resolved by a host-owned `CredentialProvider`
(an environment-backed implementation is supplied). The token is used only in
the transport header. It is absent from model prompts, action parameters,
durable events/effects/observations/reconciliation, and JSONL command data.
Errors use codes without response bodies or secrets.

The implementation pins DNS for each individual request, but an operator must
still trust the host's configured origin, DNS infrastructure, TLS trust store,
and provider. DNS can change between POST and reconciliation GET; each request
is validated independently. H4 does not implement a general network policy
engine, proxies, or production IPv6 support.

## Dispatch and uncertain outcomes

C6 persists `PREPARED`, then a live commit gate persists `DISPATCHING` before
the executor starts the POST. The request uses the C6 idempotency key in a
host-controlled `Idempotency-Key` header. Local pre-send validation failures
are `certified_not_started`. Once request transmission may have begun, timeout,
connection loss, malformed response, 3xx, and 5xx are `UNKNOWN`. A 400 with
`processed:false` is `certified_not_started` only if the host has explicitly
configured the provider's no-effect rejection contract; otherwise it is
`UNKNOWN`. Even a valid 201 report does not by itself commit the effect.

The independent observer performs an authenticated GET by idempotency key and
compares provider state with the expected name and value. A matching record
confirms the effect; conflicting state is contradictory evidence. Mere 404,
lookup failure, or missing credential remains unknown. A provider-specific,
explicit never-processed certificate permits `certified_no_effect`; recovery
then fails the effect and releases its reservation. This relies on the trusted
provider contract and authenticated lookup; the certificate is not a
cryptographic proof portable to arbitrary APIs.

On restart, C12 preserves uncertainty for an interrupted `DISPATCHING` effect.
The C7 reconciler makes only GET requests. It never repeats the POST, including
when the provider supports idempotency. Confirmed outcomes settle C6/C4 and
allow task acceptance; ambiguous outcomes retain the reservation. The
separate-process SQLite fixture proves lost response and actual `SIGKILL`
windows with one original POST and read-only recovery. This is **not an
exactly-once HTTP guarantee**: a provider without reliable lookup or
idempotency may leave an effect unknown indefinitely.

## Local demonstration

Start a local `llama-server` with `Qwen/Qwen3-4B-GGUF:Q4_K_M`, then run
`npm run demo:h4`. The script checks model health, starts the API fixture in a
separate process with its own SQLite file, submits a natural-language goal,
and prints the model plan, effect/task status, POST/GET counts, and provider
state. It reports unavailable llama.cpp clearly. The automated suite uses
fake inference and does not require a model download.

The runtime WebSocket listener remains loopback-only. Authenticated remote
control-plane access remains future work.

For a visible failure demonstration, run `npm run demo:h4:lost-response`.
It starts the external fixture in a separate process, makes one governed POST,
prints the persisted `UNKNOWN` checkpoint after the provider drops its response,
reopens the runtime database, performs a read-only lookup, and prints the final
`committed` checkpoint. Both SQLite paths are printed and retained for review.
This demo uses a host-supplied action, so it does not require Qwen; `demo:h4`
is the separate live model demonstration.
