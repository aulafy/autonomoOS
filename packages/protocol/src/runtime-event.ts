import { z } from "zod";

export const RuntimeEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number(),

  type: z.enum([
    "runtime.started",
    "control.event",

    "task.created",
    "task.completed",
    "task.failed",

    "plan.requested",
    "plan.proposed",
    "plan.accepted",
    "plan.validation_failed",

    "inference.requested",
    "inference.completed",
    "inference.failed",

    "action.proposed",

    "policy.authorized",
    "policy.denied",

    "execution.started",
    "execution.succeeded",
    "execution.failed",
    "execution.revoked",

    "observation.confirmed",
    "observation.failed",

    "agent.said",
    "agent.moved"
  ]),

  taskId: z.string().optional(),
  planId: z.string().optional(),
  intentId: z.string().optional(),
  executionId: z.string().optional(),

  actorId: z.string().optional(),
  entityId: z.string().optional(),

  correlationId: z.string().optional(),
  causationId: z.string().optional(),

  payload: z.record(z.unknown())
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
