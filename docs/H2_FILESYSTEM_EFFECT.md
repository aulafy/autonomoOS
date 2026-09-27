# H2 Governed Filesystem Effect

## Trust boundary and configuration

The host configures `AGENT_WORLD_WORKSPACE_ROOT` as an absolute existing
directory. `AGENT_WORLD_REGISTERED_FILES` is a comma-separated list of
logical relative file names to register at startup (for example,
`hello.txt,notes/summary.txt`). With no root, filesystem actions are disabled;
with no registered files, there are no file targets. The model can propose an
`ActionIntent`, but only a registered C2 resource can grant a file target.
The root is resolved to its real path and its SHA-256 binding is recorded in
resource metadata. Reopening a database against a different root fails.

Canonical IDs use C2 syntax: `dir:workspace` and
`file:workspace/hello.txt`. The model-facing `hello.txt` is only an alias.
The host stores the logical path, root binding, read/write affordances, data
label and sink classification in `ResourceRegistry`. A file's presence does
not grant authority. Grants, contract scope, leases, fencing, C8, C9, budget,
supervision and the C11 commit gate decide each request. File content for a
write must be staged by a trusted host caller as a C9 data object; its SHA-256
must match the proposed content. There is no WebSocket staging endpoint that
lets a model relabel data.

## Paths and symbolic links

Logical paths must be lowercase NFKC-stable relative names with exact `/`
segments. Traversal, absolute paths, backslashes, NUL bytes, repeated
separators, alternate case, trailing dots/spaces and unsupported characters
are rejected. C2 records are checked again before every operation. Each
existing path component is inspected with `lstat` and `realpath`; symbolic
links in parents or targets are denied. File descriptors use `O_NOFOLLOW`.
Missing final files are allowed only for a registered `create` target. The
agent cannot create directories, delete files or choose a temporary name.

H2 assumes the workspace directories are controlled by the host and are not
being concurrently renamed by an adversarial local process with the same OS
permissions. Node's portable filesystem API does not provide a directory-fd
`openat` chain or an OS sandbox for eliminating every parent-path race. A
future hardened executor can add that boundary without changing C2/C11.

## Actions and bytes

`file.read` opens the registered file read-only and keeps the bytes in the
host adapter. A confirmed read creates a resource-origin C9 data object with
the host label and adds it to the task working set; C8 records a sensitive
read. Bytes are not returned to an arbitrary sink.

`file.write` accepts a UTF-8 `content` string up to 1 MiB and an explicit
`mode`: `create` or `replace`. SHA-256 is calculated over the exact UTF-8
bytes. The expected postcondition contains that hash and byte length.
`create` uses an exclusive hard-link publication that cannot overwrite an
existing target. `replace` requires an existing regular file and uses an
atomic same-directory rename. A host-generated temporary file is written in
the target directory, flushed with `fsync`, closed, published, and the parent
directory is flushed. Temporary files are cleaned on ordinary failure.
This local technique does not make external side effects transactional.

`file.write` reserves an action and the exact byte count. Its data object is
checked through C9 against the host-classified file sink. A secret object
cannot be sent to a public file by write authority alone. The action is also
classified as an external send for conservative C8 sequence checks. Mutation
requires a resource lease and live fence. After a confirmed write, trusted
host logic advances the resource generation and records the observed hash;
startup repairs this projection if a crash occurred after effect settlement.

## Evidence and recovery

The C11 runner commits PREPARE and then commits `DISPATCHING` before the
filesystem executor is invoked. A reported executor success never commits an
effect. The independent filesystem observer opens the actual target and
hashes its bytes. It records confirmed, contradicted or unknown evidence
without trusting the executor report. C7's filesystem reconciler has only
read-only observation capability. On `UNKNOWN`, it checks reality and records
a durable decision. A confirmed hash can move `UNKNOWN` to `COMMITTED`, settle
the held budget and repair resource generation; an absent or conflicting file
never triggers an automatic write.

Fresh-process `SIGKILL` tests cover A–F: before dispatch, after the durable
marker, during filesystem publication, after write before executor result,
after observation before settlement, and after committed effect before budget
settlement. Recovery leaves file bytes and inode unchanged and is idempotent.
The final F window is injected through the domain boundary because the normal
C11 path commits effect settlement and budget consumption in one SQLite
transaction.

## Current limits

- The same-account local workspace is the security boundary described above;
  H2 does not grant arbitrary host filesystem access or execute shell commands.
- The runtime WebSocket accepts semantic intents, but writing requires a
  trusted host-staged C9 object. H2 does not expose a network endpoint for
  assigning data labels or staging arbitrary model content.
- Reads are host-held data objects; sending their bytes to a model or external
  destination needs a later, separately governed interface.
- The M5 Three.js demo and optional `llama.cpp` health check remain unchanged.
  H3 model-to-intent integration has not begun.
