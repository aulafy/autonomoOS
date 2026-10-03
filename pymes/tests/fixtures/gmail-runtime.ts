import type { CredentialVault } from "../../src/gmail-keychain.js";
import { GmailLocalConnector } from "../../src/gmail-local-connector.js";
import { GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE } from "../../src/gmail-oauth.js";
import { openWorkspaceRuntime } from "../../src/runtime-source.js";
import type { InferenceProvider, ProposedPlan } from "@agent-world/inference";
export class TestVault implements CredentialVault {
  values = new Map<string, string>();
  async get(k: string) {
    return this.values.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.values.set(k, v);
  }
  async delete(k: string) {
    this.values.delete(k);
  }
}
export async function gmailRuntime(path: string, fetcher: typeof fetch) {
  const vault = new TestVault(),
    gmail = new GmailLocalConnector(
      "owner",
      "agency",
      path + ".claims.db",
      vault,
      async () => {},
      fetcher,
    );
  await vault.set(
    gmail.oauth.credentialRef,
    JSON.stringify({
      accessToken: "synthetic-access",
      refreshToken: "synthetic-refresh",
      expiresAt: Date.now() + 3600000,
      clientId: "test.apps.googleusercontent.com",
      clientSecret: "synthetic-client",
      account: "owner@example.test",
      subject: "account-one",
      scopes: [GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE, "openid", "email"],
      generation: "b".repeat(64),
    }),
  );
  await gmail.status("owner");
  const provider: InferenceProvider = {
    id: "fixture",
    capabilities: async () => ["structured_output"],
    health: async () => ({
      ok: true,
      provider: "fixture",
      endpoint: "http://127.0.0.1",
      authConfigured: false,
    }),
    proposePlan: async (c) => ({
      plan: {
        actions: c.availableActions.map((action) => ({
          action,
          targetId: c.entities.find((e) => e.affordances.includes(action))!.id,
          parameters: {},
        })),
      } as ProposedPlan,
      rawText: "",
      latencyMs: 0,
    }),
  };
  const runtime = await openWorkspaceRuntime(path, "agency", {
    gmail,
    provider,
  });
  return {
    runtime,
    gmail,
    vault,
    close: () => {
      runtime.close();
      gmail.close();
    },
  };
}
export async function approveEmail(
  f: Awaited<ReturnType<typeof gmailRuntime>>,
) {
  f.runtime.source.createTask!("agency", "owner", {
    id: "job",
    goal: "Consulta de seguro",
  });
  await f.runtime.source.planTask!("agency", "owner", {
    taskId: "job",
    workflow: "email-lead-v1",
  });
  const email = f.runtime.source.email!;
  email.saveDraft("job", "owner", {
    to: "client@example.test",
    subject: "Correo de prueba",
    body: "Texto aprobado exactamente.",
    contactId: "test-contact",
  });
  const review = await email.propose("job", "owner");
  await email.decide("job", "owner", {
    bindingHash: review.review!.bindingHash,
    decision: "approved",
  });
}
