# C1 — SessionContract

This milestone adds the first control-plane contract boundary without changing the current M5 execution path.

## Purpose

A model may replan *how* a task is performed, but it may not silently redefine:

- the objective;
- acceptance criteria;
- forbidden effects;
- resource scope;
- risk ceiling;
- privacy class;
- deadline.

`SessionContract` is durable runtime state. It is not model memory and is not rewritten by planning.

## Added package

```text
packages/contracts/
```

The package contains:

- `SessionContractSchema`
- `ContractStore`
- `InMemoryContractStore`
- `ContractValidator`

## C1 scope

C1 deliberately does **not** integrate leases, budgets, effect transactions, reconciliation, MCP, A2A, WASI or new UI.

The next control-plane milestone is C2 `ResourceRegistry`, after C1 is proven against the user's live M5 repository.
