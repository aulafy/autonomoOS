import { parseWhatsAppInboundPayload, toOpenClawWhatsAppEnvelopes, verifyWhatsAppSignature, verifyWhatsAppWebhookChallenge } from "./whatsapp-webhook.js";
import type { OpenClawEnterpriseEnvelope } from "./openclaw-gateway.js";

export function handleWhatsAppWebhook(input: {
  request: Request;
  verifyToken: string;
  appSecret: string;
  tenantId: string;
  agentId: string;
  resourceId: string;
  pairedSenderIds?: ReadonlySet<string>;
  consentedConversationIds?: ReadonlySet<string>;
  ingest: (envelope: OpenClawEnterpriseEnvelope) => Promise<void> | void;
}): Promise<Response> {
  const url = new URL(input.request.url);
  if (input.request.method === "GET") {
    try {
      const challenge = verifyWhatsAppWebhookChallenge({ mode: url.searchParams.get("hub.mode") ?? undefined, verifyToken: url.searchParams.get("hub.verify_token") ?? undefined, challenge: url.searchParams.get("hub.challenge") ?? undefined, configuredToken: input.verifyToken });
      return Promise.resolve(new Response(challenge, { status: 200, headers: { "content-type": "text/plain", "cache-control": "no-store" } }));
    } catch { return Promise.resolve(new Response("Forbidden", { status: 403 })); }
  }
  if (input.request.method !== "POST") return Promise.resolve(new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } }));
  return input.request.text().then(async rawBody => {
    if (!verifyWhatsAppSignature({ rawBody, signature: input.request.headers.get("x-hub-signature-256") ?? undefined, appSecret: input.appSecret })) return new Response("Forbidden", { status: 403 });
    let payload: unknown;
    try { payload = JSON.parse(rawBody); } catch { return new Response("Bad Request", { status: 400 }); }
    try {
      const messages = parseWhatsAppInboundPayload(payload);
      const envelopes = toOpenClawWhatsAppEnvelopes({ messages, tenantId: input.tenantId, agentId: input.agentId, resourceId: input.resourceId, pairedSenderIds: input.pairedSenderIds, consentedConversationIds: input.consentedConversationIds });
      for (const envelope of envelopes) await input.ingest(envelope);
      return new Response(JSON.stringify({ received: envelopes.length }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    } catch { return new Response("Bad Request", { status: 400 }); }
  });
}
