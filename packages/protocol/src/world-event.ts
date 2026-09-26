import { z } from "zod";

export const WorldEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.number(),

  type: z.enum([
    "agent.said",
    "agent.moved",
    "agent.looked_at",
    "object.picked",
    "object.dropped",
    "tool.started",
    "tool.completed",
    "tool.failed",
    "task.started",
    "task.completed",
    "task.failed"
  ]),

  actorId: z.string().optional(),
  entityId: z.string().optional(),
  taskId: z.string().optional(),
  payload: z.record(z.unknown())
});

export type WorldEvent = z.infer<typeof WorldEventSchema>;
