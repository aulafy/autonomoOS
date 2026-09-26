# Agent World OS — Starter

This repository is the first implementation slice of the Agent World OS architecture.

## Goal of v0.1

Prove this loop:

```text
Human / Script
    ↓
ActionIntent
    ↓
Policy Engine
    ↓
World Runtime
    ↓
WorldEvent
    ↓
Three.js Client
    ↓
Replayable Event Log
```

No LLM is required yet.

## Install

```bash
npm install
```

## Run the agent runtime

```bash
npm run dev:runtime
```

The runtime listens on:

```text
ws://localhost:8787
```

## Run the Three.js client

In another terminal:

```bash
npm run dev:world
```

Open the local Vite URL shown in the terminal.

## First demo

The runtime emits a scripted `agent.moved` event every few seconds.
The Three.js client receives the event and moves the Astra placeholder.

The next milestone is to replace the scripted event with a validated `ActionIntent`.
