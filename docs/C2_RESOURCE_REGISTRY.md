# C2 — Canonical Resource Registry

`@agent-world/resources` is the host-side index for stable resource identity. A model may name a resource; `ResourceResolver` accepts it only when the host registry contains it. Canonical-looking input never falls back to an alias. Duplicate aliases remain possible, but ambiguous resolution fails closed.

Before activating a `SessionContract`, compile human-facing names with `compileResourceScope`. The resulting `allowedResourceIds` contain canonical IDs. C1 validates this shape; the C2 package does not grant authority or integrate with the M5 runtime.

`createDemoResources` and `registerLegacyWorldEntity` map `meeting_room`, `home_point`, and `astra` at the compatibility boundary. Existing world IDs and `ActionIntent` behavior remain unchanged. Registry data labels and sink metadata are supplied by host-owned registration code, not by model output. The `DerivedResourcePolicy` interface is only a seam; no filesystem derivation is implemented.

Run `npm --workspace @agent-world/resources run typecheck`, `npm --workspace @agent-world/resources test`, and `npm test` from the repository root.
