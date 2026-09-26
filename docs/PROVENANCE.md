# Provenance Model

Agent World OS must distinguish four separate truths:

1. What was proposed.
2. What policy authorized.
3. What the executor attempted.
4. What the environment actually confirmed.

Lifecycle:

```text
action.proposed
  ├── policy.denied
  └── policy.authorized
        ↓
    execution.started
        ├── execution.failed
        ├── execution.revoked
        └── execution.succeeded
              ↓
        observation.confirmed
```

## Core invariant

`execution.succeeded` does **not** mean completed work.

Only `observation.confirmed` may establish that a consequential state
transition actually happened.

Therefore:

- denied actions never execute;
- revoked actions do not appear as completed work;
- replay shows denied/revoked attempts, but with their real status;
- proposal, authorization, execution and observation remain separate records.
