import { WebSocketServer, WebSocket } from "ws";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoControlPlane } from "./demo-control-plane.js";
import { FilesystemWorkspace, validateLogicalPath } from "@agent-world/filesystem";
import { mintResourceId } from "@agent-world/resources";
import { createDurableDomainStores, DurableRuntimeEventPublisher, JournalKernel, ReplayClock,
  RuntimeDatabase } from "@agent-world/runtime-store-sqlite";

import {
  ActionIntentSchema,
  type RuntimeEvent,
  type WorldEntity
} from "@agent-world/protocol";

import {
  WorldRuntime
} from "@agent-world/world-core";

import {
  LlamaCppProvider,
  ProposedPlanSchema,
  type ProposedAction,
  type ProposedPlan
} from "@agent-world/inference";

const RUNTIME_PORT =
  Number(process.env.AGENT_RUNTIME_PORT ?? 8787);

const DEFAULT_AGENT_ID =
  process.env.DEFAULT_AGENT_ID ?? "astra";

const world = new WorldRuntime();

const clock = new ReplayClock();
const database = new RuntimeDatabase(process.env.AGENT_WORLD_DB_PATH
  ? resolve(process.env.AGENT_WORLD_DB_PATH)
  : fileURLToPath(new URL("../../../data/agent-world-os.db", import.meta.url)), clock.now);
const kernel = new JournalKernel(database, clock);
const stores = createDurableDomainStores(kernel);
await kernel.restore();
const filesystem = process.env.AGENT_WORLD_WORKSPACE_ROOT
  ? new FilesystemWorkspace(resolve(process.env.AGENT_WORLD_WORKSPACE_ROOT), stores.resources)
  : undefined;
if (filesystem) {
  filesystem.registerRoot();
  for (const raw of (process.env.AGENT_WORLD_REGISTERED_FILES ?? "")
    .split(",").filter(Boolean)) {
    const relativePath = validateLogicalPath(raw);
    if (!stores.resources.has(mintResourceId("file", `workspace/${relativePath}`))) {
      filesystem.registerFile({ relativePath });
    }
  }
}
const runtimePublisher = new DurableRuntimeEventPublisher<RuntimeEvent>(database,
  publishRuntimeEvent);
const events = {
  append: (event: RuntimeEvent) => runtimePublisher.append(event),
  readAll: () => database.runtimeEvents() as unknown as RuntimeEvent[]
};

const inference = new LlamaCppProvider();

const runningExecutions =
  new Map<string, AbortController>();

const entities: WorldEntity[] = [
  {
    id: "astra",
    kind: "agent",
    name: "Astra",
    state: {},
    affordances: [
      "goto",
      "say",
      "look_at",
      "use_tool"
    ],
    transform: {
      position: [0, 0.5, 0],
      rotation: [0, 0, 0, 1]
    }
  },

  {
    id: "home_point",
    kind: "space",
    name: "Home Point",
    state: {},
    affordances: [
      "enter",
      "look_at"
    ],
    transform: {
      position: [0, 0.5, 0],
      rotation: [0, 0, 0, 1]
    }
  },

  {
    id: "meeting_room",
    kind: "space",
    name: "Meeting Room",
    state: {},
    affordances: [
      "enter",
      "look_at"
    ],
    transform: {
      position: [4, 0.5, -2],
      rotation: [0, 0, 0, 1]
    }
  }
];

for (const entity of entities) {
  world.addEntity(entity);
}

const wss =
  new WebSocketServer({
    port: RUNTIME_PORT
  });

console.log(
  `Agent Runtime running at ws://localhost:${RUNTIME_PORT}`
);

void inference
  .health()
  .then(health => {
    console.log(
      `[inference] ${health.ok ? "ready" : "unavailable"} ` +
      `${health.endpoint}` +
      `${health.model ? ` model=${health.model}` : ""}` +
      `${health.detail ? ` detail=${health.detail}` : ""}`
    );
  });

function runtimeEvent(
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

function emit(
  event: RuntimeEvent
): void {
  events.append(event as any);
}

function publishRuntimeEvent(event: RuntimeEvent): void {

  const message = JSON.stringify({
    type: "runtime.event",
    event
  });

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }

    client.send(message);

    // Compatibility message for the current renderer.
    if (
      event.type === "agent.moved" ||
      event.type === "agent.said"
    ) {
      client.send(
        JSON.stringify({
          type: "world.event",
          event
        })
      );
    }
  }

  console.log(
    `[${event.type}]` +
    `${event.taskId ? ` task=${event.taskId.slice(0, 8)}` : ""}` +
    `${event.intentId ? ` intent=${event.intentId.slice(0, 8)}` : ""}` +
    `${event.executionId ? ` exec=${event.executionId.slice(0, 8)}` : ""}`
  );
}

type IntentOutcome =
  | { status: "observed"; intentId: string; executionId: string }
  | { status: "denied" | "failed" | "revoked"; intentId: string;
      executionId?: string; reason?: string };

const governance = createDemoControlPlane(world, emit, { kernel, stores, filesystem });
governance.recoverOnStartup();
if (filesystem) await governance.reconcilePendingFilesystem();

async function processIntent(raw: unknown, options?: { taskId?: string;
  planId?: string; correlationId?: string }): Promise<IntentOutcome> {
  const intent = ActionIntentSchema.parse(raw);
  const taskId = options?.taskId ?? crypto.randomUUID();
  const correlationId = options?.correlationId ?? taskId;
  const planId = options?.planId;
  emit(runtimeEvent("action.proposed", { taskId, planId, correlationId,
    intentId: intent.id, actorId: intent.actorId, payload: {
      action: intent.action, targetId: intent.targetId ?? null,
      parameters: intent.parameters ?? {}, provenance: intent.provenance } }));
  const controller = new AbortController();
  runningExecutions.set(intent.id, controller);
  try {
    const result = await governance.run(intent, taskId, correlationId, planId,
      controller.signal);
    const executionId = result.effectId;
    if (result.status === "completed") {
      emit(runtimeEvent("policy.authorized", { taskId, planId, correlationId,
        intentId: intent.id, actorId: intent.actorId,
        payload: { effectId: result.effectId, reason: result.reasonCode } }));
      emit(runtimeEvent("execution.succeeded", { taskId, planId, correlationId,
        intentId: intent.id, executionId, actorId: intent.actorId,
        payload: { effectId: result.effectId } }));
      emit(runtimeEvent("observation.confirmed", { taskId, planId, correlationId,
        intentId: intent.id, executionId, actorId: intent.actorId,
        payload: { observationIds: result.observationIds } }));
      return { status: "observed", intentId: intent.id,
        executionId: executionId ?? "" };
    }
    if (result.status === "denied" || result.status === "blocked" ||
      result.status === "approval_required" ||
      result.status === "release_approval_required") {
      emit(runtimeEvent("policy.denied", { taskId, planId, correlationId,
        intentId: intent.id, actorId: intent.actorId,
        payload: { reason: result.reasonCode, effectId: result.effectId } }));
      return { status: "denied", intentId: intent.id, executionId,
        reason: result.reasonCode };
    }
    emit(runtimeEvent("execution.failed", { taskId, planId, correlationId,
      intentId: intent.id, executionId, actorId: intent.actorId,
      payload: { reason: result.reasonCode, status: result.status } }));
    return { status: result.status === "unknown" && controller.signal.aborted
      ? "revoked" : "failed", intentId: intent.id, executionId,
      reason: result.reasonCode };
  } finally {
    runningExecutions.delete(intent.id);
  }
}

const availableActions = [
  "goto",
  "say",
  "look_at",
  "ask_human",
  "purchase_compute"
];

function validatePlanSemantics(
  plan: ProposedPlan
): {
  ok: true;
} | {
  ok: false;
  reason: string;
} {
  const entityIds =
    new Set(
      entities.map(
        entity => entity.id
      )
    );

  const actions =
    new Set(
      availableActions
    );

  for (
    const [index, action]
    of plan.actions.entries()
  ) {
    if (
      !actions.has(
        action.action
      )
    ) {
      return {
        ok: false,
        reason:
          `Action ${index + 1}: unsupported action '${action.action}'.`
      };
    }

    if (
      action.targetId &&
      !entityIds.has(
        action.targetId
      )
    ) {
      return {
        ok: false,
        reason:
          `Action ${index + 1}: unknown entity '${action.targetId}'.`
      };
    }

    if (
      (
        action.action === "goto" ||
        action.action === "look_at"
      ) &&
      !action.targetId
    ) {
      return {
        ok: false,
        reason:
          `Action ${index + 1}: '${action.action}' requires targetId.`
      };
    }

    if (
      action.action === "say"
    ) {
      const text =
        action.parameters?.text;

      if (
        typeof text !== "string" ||
        text.trim().length === 0
      ) {
        return {
          ok: false,
          reason:
            `Action ${index + 1}: 'say' requires parameters.text.`
        };
      }
    }

    if (
      action.action === "purchase_compute"
    ) {
      const units =
        action.parameters?.units;

      if (
        units !== undefined &&
        (
          typeof units !== "number" ||
          !Number.isFinite(units) ||
          units <= 0
        )
      ) {
        return {
          ok: false,
          reason:
            `Action ${index + 1}: purchase_compute units must be a positive number.`
        };
      }
    }
  }

  return {
    ok: true
  };
}

async function proposePlan(
  goal: string
) {
  return inference.proposePlan({
    agentId:
      DEFAULT_AGENT_ID,

    userGoal:
      goal,

    availableActions,

    entities:
      entities.map(
        entity => ({
          id:
            entity.id,

          kind:
            entity.kind,

          name:
            entity.name,

          affordances:
            entity.affordances
        })
      )
  });
}

function compileActionToIntent(
  action: ProposedAction,
  planId: string
) {
  return ActionIntentSchema.parse({
    id:
      crypto.randomUUID(),

    actorId:
      DEFAULT_AGENT_ID,

    action:
      action.action,

    targetId:
      action.targetId,

    parameters:
      action.parameters ?? {},

    provenance: {
      source:
        "model",

      sourceId:
        planId
    }
  });
}

async function runGoal(
  goal: string
) {
  const taskId =
    crypto.randomUUID();

  const correlationId =
    taskId;

  const planId =
    crypto.randomUUID();

  emit(
    runtimeEvent(
      "task.created",
      {
        taskId,
        correlationId,

        actorId:
          DEFAULT_AGENT_ID,

        payload: {
          goal
        }
      }
    )
  );

  emit(
    runtimeEvent(
      "plan.requested",
      {
        taskId,
        planId,
        correlationId,

        actorId:
          DEFAULT_AGENT_ID,

        payload: {
          goal
        }
      }
    )
  );

  emit(
    runtimeEvent(
      "inference.requested",
      {
        taskId,
        planId,
        correlationId,

        actorId:
          DEFAULT_AGENT_ID,

        payload: {
          provider:
            inference.id
        }
      }
    )
  );

  let inferenceResult:
    Awaited<
      ReturnType<
        typeof inference.proposePlan
      >
    >;

  try {
    inferenceResult =
      await proposePlan(goal);

    emit(
      runtimeEvent(
        "inference.completed",
        {
          taskId,
          planId,
          correlationId,

          actorId:
            DEFAULT_AGENT_ID,

          payload: {
            provider:
              inference.id,

            model:
              inferenceResult.model ?? null,

            latencyMs:
              inferenceResult.latencyMs
          }
        }
      )
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    emit(
      runtimeEvent(
        "inference.failed",
        {
          taskId,
          planId,
          correlationId,

          actorId:
            DEFAULT_AGENT_ID,

          payload: {
            provider:
              inference.id,

            error:
              message
          }
        }
      )
    );

    emit(
      runtimeEvent(
        "task.failed",
        {
          taskId,
          planId,
          correlationId,

          actorId:
            DEFAULT_AGENT_ID,

          payload: {
            reason:
              "Inference failed.",

            error:
              message
          }
        }
      )
    );

    return {
      ok: false,
      taskId,
      reason: message
    };
  }

  const plan =
    ProposedPlanSchema.parse(
      inferenceResult.plan
    );

  emit(
    runtimeEvent(
      "plan.proposed",
      {
        taskId,
        planId,
        correlationId,

        actorId:
          DEFAULT_AGENT_ID,

        payload: {
          provider:
            inference.id,

          model:
            inferenceResult.model ?? null,

          actions:
            plan.actions
        }
      }
    )
  );

  const validation =
    validatePlanSemantics(
      plan
    );

  if (!validation.ok) {
    emit(
      runtimeEvent(
        "plan.validation_failed",
        {
          taskId,
          planId,
          correlationId,

          actorId:
            DEFAULT_AGENT_ID,

          payload: {
            reason:
              validation.reason
          }
        }
      )
    );

    emit(
      runtimeEvent(
        "task.failed",
        {
          taskId,
          planId,
          correlationId,

          actorId:
            DEFAULT_AGENT_ID,

          payload: {
            reason:
              "Plan validation failed.",

            detail:
              validation.reason
          }
        }
      )
    );

    return {
      ok: false,
      taskId,
      reason:
        validation.reason
    };
  }

  emit(
    runtimeEvent(
      "plan.accepted",
      {
        taskId,
        planId,
        correlationId,

        actorId:
          DEFAULT_AGENT_ID,

        payload: {
          actionCount:
            plan.actions.length
        }
      }
    )
  );

  for (
    let index = 0;
    index < plan.actions.length;
    index += 1
  ) {
    const action =
      plan.actions[index]!;

    let intent;

    try {
      intent =
        compileActionToIntent(
          action,
          planId
        );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      emit(
        runtimeEvent(
          "task.failed",
          {
            taskId,
            planId,
            correlationId,

            actorId:
              DEFAULT_AGENT_ID,

            payload: {
              reason:
                "Could not compile proposed action into ActionIntent.",

              actionIndex:
                index,

              error:
                message
            }
          }
        )
      );

      return {
        ok: false,
        taskId,
        reason: message
      };
    }

    const result =
      await processIntent(
        intent,
        {
          taskId,
          planId,
          correlationId
        }
      );

    if (
      result.status !== "observed"
    ) {
      emit(
        runtimeEvent(
          "task.failed",
          {
            taskId,
            planId,
            correlationId,

            intentId:
              result.intentId,

            executionId:
              result.executionId,

            actorId:
              DEFAULT_AGENT_ID,

            payload: {
              reason:
                `Action ${index + 1} did not reach observed success.`,

              action:
                action.action,

              status:
                result.status,

              detail:
                result.reason ?? null
            }
          }
        )
      );

      return {
        ok: false,
        taskId,
        reason:
          result.reason ??
          result.status
      };
    }
  }

  if (!(await governance.mayComplete(taskId))) {
    emit(runtimeEvent("task.failed", { taskId, planId, correlationId,
      actorId: DEFAULT_AGENT_ID, payload: { reason: "Acceptance criteria not observed." } }));
    return { ok: false, taskId, reason: "Acceptance criteria not observed." };
  }

  emit(
    runtimeEvent(
      "task.completed",
      {
        taskId,
        planId,
        correlationId,

        actorId:
          DEFAULT_AGENT_ID,

        payload: {
          goal,
          actionCount:
            plan.actions.length
        }
      }
    )
  );

  return {
    ok: true,
    taskId
  };
}

async function replay(
  socket: WebSocket,
  limit = 50
) {
  const all =
    events.readAll() as any[];

  const selected =
    all.slice(
      -Math.min(
        Math.max(limit, 1),
        250
      )
    );

  socket.send(
    JSON.stringify({
      type:
        "replay.started",

      count:
        selected.length
    })
  );

  for (
    const event
    of selected
  ) {
    socket.send(
      JSON.stringify({
        type:
          "replay.event",

        event
      })
    );

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          180
        )
    );
  }

  socket.send(
    JSON.stringify({
      type:
        "replay.completed",

      count:
        selected.length
    })
  );
}

wss.on(
  "connection",
  socket => {
    console.log(
      "[ws] client connected"
    );

    socket.send(
      JSON.stringify({
        type:
          "runtime.ready",

        eventCount:
          events.readAll().length
      })
    );

    socket.on(
      "message",
      async data => {
        try {
          const message =
            JSON.parse(
              data.toString()
            );

          if (
            message.type ===
            "action.intent"
          ) {
            const result =
              await processIntent(
                message.intent
              );

            socket.send(
              JSON.stringify({
                type:
                  "action.result",

                result
              })
            );

            return;
          }

          if (
            message.type ===
            "action.revoke"
          ) {
            const intentId =
              String(
                message.intentId ?? ""
              );

            const controller =
              runningExecutions.get(
                intentId
              );

            if (controller) {
              controller.abort();
            }

            socket.send(
              JSON.stringify({
                type:
                  "revoke.result",

                intentId,

                revoked:
                  Boolean(controller)
              })
            );

            return;
          }

          if (
            message.type ===
            "replay.request"
          ) {
            await replay(
              socket,
              Number(
                message.limit ?? 50
              )
            );

            return;
          }

          if (
            message.type ===
            "inference.health.request"
          ) {
            const health =
              await inference.health();

            socket.send(
              JSON.stringify({
                type:
                  "inference.health.result",

                health
              })
            );

            return;
          }

          if (
            message.type ===
            "agent.plan.request"
          ) {
            const goal =
              String(
                message.goal ?? ""
              ).trim();

            if (!goal) {
              throw new Error(
                "Goal is empty."
              );
            }

            const result =
              await proposePlan(
                goal
              );

            const validation =
              validatePlanSemantics(
                result.plan
              );

            socket.send(
              JSON.stringify({
                type:
                  "agent.plan.proposed",

                proposal: {
                  provider:
                    inference.id,

                  model:
                    result.model ?? null,

                  latencyMs:
                    result.latencyMs,

                  goal,

                  validation,

                  plan:
                    result.plan
                }
              })
            );

            return;
          }

          if (
            message.type ===
            "agent.goal.run"
          ) {
            const goal =
              String(
                message.goal ?? ""
              ).trim();

            if (!goal) {
              throw new Error(
                "Goal is empty."
              );
            }

            const result =
              await runGoal(
                goal
              );

            socket.send(
              JSON.stringify({
                type:
                  "agent.goal.result",

                result
              })
            );

            return;
          }
        } catch (error) {
          socket.send(
            JSON.stringify({
              type:
                "runtime.error",

              error:
                error instanceof Error
                  ? error.message
                  : String(error)
            })
          );
        }
      }
    );

    socket.on(
      "close",
      () => {
        console.log(
          "[ws] client disconnected"
        );
      }
    );
  }
);
