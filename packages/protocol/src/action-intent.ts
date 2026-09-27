import { z } from "zod";

export const ActionIntentSchema = z.object({
  id: z.string().min(1),
  actorId: z.string().min(1),

  action: z.enum([
    "say",
    "goto",
    "look_at",
    "pick",
    "drop",
    "use",
    "use_tool",
    "delegate",
    "purchase_compute",
    "ask_human",
    "file.read", "file.write", "api.create_record"
  ]),

  targetId: z.string().optional(),

  parameters: z.record(z.unknown()).optional(),

  constraints: z.object({
    deadlineMs: z.number().nonnegative().optional(),
    maxCost: z.number().nonnegative().optional(),
    privacy: z.enum(["local", "trusted", "cloud"]).optional()
  }).optional(),

  provenance: z.object({
    source: z.enum(["human", "model", "rule", "agent"]),
    sourceId: z.string().optional(),
    taskId: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    inferenceRequestId: z.string().optional(),
    promptHash: z.string().optional(),
    responseHash: z.string().optional()
  })
});

export type ActionIntent = z.infer<typeof ActionIntentSchema>;
