# Milestone 5 — Governed Natural-Language Execution

## Goal

Convert a human natural-language goal into a model-proposed plan and execute each
validated action through the existing governance lifecycle.

The model never directly mutates world state.

## Flow

```text
human goal
  ↓
task.created
  ↓
plan.requested
  ↓
inference.requested
  ↓
local model
  ↓
inference.completed
  ↓
plan.proposed
  ↓
semantic validation
  ↓
plan.accepted
  ↓
ActionIntent
  ↓
policy
  ↓
execution
  ↓
observation
  ↓
next ActionIntent
  ↓
task.completed
```

## Completion invariant

A task completes only when every action reaches:

```text
observation.confirmed
```

An executor acknowledgement is insufficient.

## No replanning yet

M5 deliberately does not automatically replan.

Any of the following causes `task.failed`:

- inference failure;
- plan validation failure;
- policy denial;
- execution failure;
- execution revocation;
- lack of confirmed observation.

Automatic replanning belongs to M6.

## Proposal-only mode

`Ask Local Model` remains non-executing.

`Run Goal` is the governed execution path.

## llama.cpp authentication

The provider supports:

```env
LLAMA_BASE_URL=http://127.0.0.1:8080
LLAMA_API_KEY=optional-key
```

If the server has authentication enabled, the runtime sends:

```text
Authorization: Bearer <LLAMA_API_KEY>
```

If the server is deliberately started without authentication, leave
`LLAMA_API_KEY` unset for the runtime.

## Acceptance test

Input:

```text
Go to the meeting room and say that you are ready.
```

Expected lifecycle:

```text
task.created
plan.requested
inference.requested
inference.completed
plan.proposed
plan.accepted

action.proposed
policy.authorized
execution.started
execution.succeeded
agent.moved
observation.confirmed

action.proposed
policy.authorized
execution.started
execution.succeeded
agent.said
observation.confirmed

task.completed
```

## Negative test

A model-generated `purchase_compute` action should reach policy evaluation and be
denied by the current v0 policy.

It must never emit:

```text
execution.started
execution.succeeded
observation.confirmed
```

for that intent.

## Hallucination test

If the model invents an entity ID, the plan is rejected before ActionIntent
execution:

```text
plan.proposed
plan.validation_failed
task.failed
```

## Replay

Replay stays read-only.

It must not:

- call the model;
- call policy;
- call executors;
- append new domain events;
- create new side effects.
