# C9 InformationFlowPolicy

Authorized read and authorized send do not authorize movement of the exact data between them. C9 evaluates concrete task data object IDs against a host-controlled sink descriptor. Unknown objects, labels, sinks and working-set membership fail closed. A cloud model provider is an external sink for prompt/context data.

Data labels order public < internal < confidential < restricted < secret. Derived objects from summarize, translate, paraphrase, formatting, LLM output or combination join all source labels and preserve explicit lineage. No declassification path exists in C9. `DataObjectCompiler` can import a host label from C2 ResourceRegistry; a missing label remains unknown.

Rules deny secret-to-public, restricted-to-external, credential-to-external, personal-to-public and non-releasable-to-external flows. Confidential-to-external requires a release approval. Public data may flow when no rule blocks it. A release approval is scoped to task, intent, exact object IDs, exact sink, working-set version and expiry. It never lowers a label, creates authority or overrides a deny.

Each task working set advances a version when an object enters it. Every flow decision records that version; C11 must re-evaluate stale decisions immediately before dispatch. C9 stores are in memory and are not wired into M5 yet.
