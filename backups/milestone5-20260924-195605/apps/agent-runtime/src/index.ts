import { WebSocketServer, WebSocket } from "ws";
import {
  ActionIntentSchema,
  type RuntimeEvent,
  type WorldEntity
} from "@agent-world/protocol";
import { WorldRuntime } from "@agent-world/world-core";
import { authorize } from "@agent-world/policy-engine";
import { JsonlEventStore } from "@agent-world/event-store";
import {
  LlamaCppProvider,
  ProposedPlanSchema
} from "@agent-world/inference";

const world = new WorldRuntime();
const events = new JsonlEventStore("../../data/events/world.jsonl");
const running = new Map<string, AbortController>();
const inference = new LlamaCppProvider();

const entities: WorldEntity[] = [
  {
    id: "astra",
    kind: "agent",
    name: "Astra",
    state: {},
    affordances: ["goto", "say", "look_at", "use_tool"],
    transform: { position: [0, 0.5, 0], rotation: [0, 0, 0, 1] }
  },
  {
    id: "home_point",
    kind: "space",
    name: "Home Point",
    state: {},
    affordances: ["enter"],
    transform: { position: [0, 0.5, 0], rotation: [0, 0, 0, 1] }
  },
  {
    id: "meeting_room",
    kind: "space",
    name: "Meeting Room",
    state: {},
    affordances: ["enter"],
    transform: { position: [4, 0.5, -2], rotation: [0, 0, 0, 1] }
  }
];

for (const entity of entities) world.addEntity(entity);

const wss = new WebSocketServer({ port: 8787 });
console.log("Agent Runtime running at ws://localhost:8787");

function evt(
  type: RuntimeEvent["type"],
  data: Partial<RuntimeEvent> = {}
): RuntimeEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type,
    payload: {},
    ...data
  };
}

function emit(event: RuntimeEvent) {
  events.append(event as any);

  const wire = JSON.stringify({
    type: "runtime.event",
    event
  });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(wire);

      if (event.type === "agent.moved" || event.type === "agent.said") {
        client.send(JSON.stringify({
          type: "world.event",
          event
        }));
      }
    }
  }

  console.log(
    `[${event.type}]` +
    `${event.intentId ? ` intent=${event.intentId.slice(0,8)}` : ""}`
  );
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("REVOKED"));
    }, { once: true });
  });
}

async function processIntent(raw: unknown) {
  const intent = ActionIntentSchema.parse(raw);

  emit(evt("action.proposed", {
    intentId: intent.id,
    actorId: intent.actorId,
    payload: {
      action: intent.action,
      targetId: intent.targetId ?? null,
      parameters: intent.parameters ?? {},
      provenance: intent.provenance
    }
  }));

  const decision = authorize(intent);

  if (!decision.allowed) {
    emit(evt("policy.denied", {
      intentId: intent.id,
      actorId: intent.actorId,
      payload: {
        risk: decision.risk,
        reason: decision.reason
      }
    }));
    return;
  }

  emit(evt("policy.authorized", {
    intentId: intent.id,
    actorId: intent.actorId,
    payload: {
      risk: decision.risk,
      reason: decision.reason
    }
  }));

  const executionId = crypto.randomUUID();
  const controller = new AbortController();
  running.set(intent.id, controller);

  emit(evt("execution.started", {
    intentId: intent.id,
    executionId,
    actorId: intent.actorId,
    payload: { action: intent.action }
  }));

  try {
    if (
      intent.action === "use_tool" &&
      intent.parameters?.tool === "demo.slow"
    ) {
      await wait(5000, controller.signal);

      emit(evt("execution.succeeded", {
        intentId: intent.id,
        executionId,
        actorId: intent.actorId,
        payload: { tool: "demo.slow" }
      }));

      emit(evt("observation.confirmed", {
        intentId: intent.id,
        executionId,
        actorId: intent.actorId,
        payload: {
          observed: true,
          tool: "demo.slow"
        }
      }));

      return;
    }

    const worldEvent = world.execute(intent);

    emit(evt("execution.succeeded", {
      intentId: intent.id,
      executionId,
      actorId: intent.actorId,
      entityId: worldEvent.entityId,
      payload: worldEvent.payload
    }));

    emit(evt(worldEvent.type as RuntimeEvent["type"], {
      intentId: intent.id,
      executionId,
      actorId: worldEvent.actorId,
      entityId: worldEvent.entityId,
      payload: worldEvent.payload
    }));

    emit(evt("observation.confirmed", {
      intentId: intent.id,
      executionId,
      actorId: intent.actorId,
      entityId: worldEvent.entityId,
      payload: {
        observed: true,
        observedEventType: worldEvent.type
      }
    }));
  } catch (error) {
    if (error instanceof Error && error.message === "REVOKED") {
      emit(evt("execution.revoked", {
        intentId: intent.id,
        executionId,
        actorId: intent.actorId,
        payload: {
          reason: "Revoked by user"
        }
      }));
    } else {
      emit(evt("execution.failed", {
        intentId: intent.id,
        executionId,
        actorId: intent.actorId,
        payload: {
          error: error instanceof Error ? error.message : String(error)
        }
      }));
    }
  } finally {
    running.delete(intent.id);
  }
}

async function proposePlan(goal: string) {
  const availableActions = [
    "goto",
    "say",
    "look_at",
    "ask_human"
  ];

  const result = await inference.proposePlan({
    agentId: "astra",
    userGoal: goal,
    availableActions,
    entities: entities.map(entity => ({
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      affordances: entity.affordances
    }))
  });

  const plan = ProposedPlanSchema.parse(result.plan);

  return {
    provider: inference.id,
    model: result.model ?? null,
    latencyMs: result.latencyMs,
    goal,
    plan
  };
}

async function replay(socket: WebSocket, limit = 30) {
  const all = events.readAll() as any[];
  const selected = all.slice(-Math.min(Math.max(limit, 1), 100));

  socket.send(JSON.stringify({
    type: "replay.started",
    count: selected.length
  }));

  for (const event of selected) {
    socket.send(JSON.stringify({
      type: "replay.event",
      event
    }));
    await new Promise(r => setTimeout(r, 220));
  }

  socket.send(JSON.stringify({
    type: "replay.completed",
    count: selected.length
  }));
}

wss.on("connection", socket => {
  console.log("[ws] client connected");

  socket.send(JSON.stringify({
    type: "runtime.ready",
    eventCount: events.readAll().length
  }));

  socket.on("message", async data => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "action.intent") {
        await processIntent(message.intent);
        return;
      }

      if (message.type === "action.revoke") {
        const controller = running.get(String(message.intentId));
        if (controller) controller.abort();

        socket.send(JSON.stringify({
          type: "revoke.result",
          intentId: message.intentId,
          revoked: Boolean(controller)
        }));
        return;
      }

      if (message.type === "replay.request") {
        await replay(socket, Number(message.limit ?? 30));
        return;
      }

      if (message.type === "inference.health.request") {
        const health = await inference.health();

        socket.send(JSON.stringify({
          type: "inference.health.result",
          health
        }));
        return;
      }

      if (message.type === "agent.plan.request") {
        const goal = String(message.goal ?? "").trim();

        if (!goal) {
          throw new Error("Goal is empty");
        }

        const proposal = await proposePlan(goal);

        console.log(
          `[plan.proposed] ${proposal.plan.actions.length} action(s) ` +
          `via ${proposal.provider} in ${proposal.latencyMs}ms`
        );

        socket.send(JSON.stringify({
          type: "agent.plan.proposed",
          proposal
        }));

        return;
      }
    } catch (error) {
      socket.send(JSON.stringify({
        type: "runtime.error",
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  });
});
