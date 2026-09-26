import { z } from "zod";
import { isCanonicalResourceId } from "@agent-world/resources";

export const ContractRiskSchema = z.enum([
  "R0",
  "R1",
  "R2",
  "R3",
  "R4",
  "R5"
]);

export type ContractRisk = z.infer<typeof ContractRiskSchema>;

export const ContractPrivacySchema = z.enum([
  "local_only",
  "trusted_remote",
  "cloud_allowed",
  "public"
]);

export type ContractPrivacy = z.infer<typeof ContractPrivacySchema>;

export const SessionContractSchema = z.object({
  id: z.string().min(1),
  ownerPrincipalId: z.string().min(1),
  taskId: z.string().min(1),

  objective: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),

  forbiddenEffects: z.array(z.string().min(1)).default([]),
  allowedResourceIds: z.array(z.string().refine(isCanonicalResourceId, {
    message: "Contract resource scope requires canonical ResourceIds."
  })).default([]),

  maxRisk: ContractRiskSchema,
  privacyClass: ContractPrivacySchema,

  budgetId: z.string().min(1).optional(),
  authorityLeaseId: z.string().min(1).optional(),
  deadlineAt: z.number().finite().optional(),

  createdAt: z.number().finite(),
  version: z.number().int().positive(),

  status: z.enum([
    "active",
    "completed",
    "cancelled",
    "expired"
  ]),

  metadata: z.record(z.unknown()).default({})
});

export type SessionContract = z.infer<typeof SessionContractSchema>;

export function cloneContract(contract: SessionContract): SessionContract {
  return structuredClone(contract);
}
