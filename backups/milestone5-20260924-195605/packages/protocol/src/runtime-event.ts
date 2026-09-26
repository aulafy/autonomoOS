import { z } from "zod";

export const RuntimeEventSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  type: z.enum([
    "action.proposed",
    "policy.authorized",
    "policy.denied",
    "execution.started",
    "execution.succeeded",
    "execution.failed",
    "execution.revoked",
    "observation.confirmed",
    "agent.said",
    "agent.moved"
  ]),
  intentId: z.string().optional(),
  executionId: z.string().optional(),
  actorId: z.string().optional(),
  entityId: z.string().optional(),
  payload: z.record(z.unknown())
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
