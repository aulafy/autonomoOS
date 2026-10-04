import type { WorkspaceApiRequest, WorkspaceApiResponse, WorkspaceRepository, WorkspaceRuntimeSource } from "./workspace-api.js";
import { InboxStoreError, type ListScope } from "./inbox-store.js";
import { contextOf } from "./inbox-service.js";

/**
 * P04a — /v1/workspaces/<tenant>/gmail-inbox routes. Owner role only, same
 * contract as /gmail. Tenant and owner come from the session; the account from
 * the verified Gmail credential or an opaque server-issued accountRef of an
 * account owned by that same owner. Never trusts ns, subject or owner from the
 * client. Message content of a previously connected account is not returned
 * while a different account is connected. Separate from /inbox (remote cases).
 */
const REF = /^[a-f0-9]{32}$/;
const GMAIL_ID = /^[-a-zA-Z0-9_]{1,100}$/;
function bearer(request: WorkspaceApiRequest) {
  const value = request.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function query(path: string) {
  const i = path.indexOf("?");
  return new URLSearchParams(i < 0 ? "" : path.slice(i + 1));
}
export async function handleGmailInboxRequest(
  request: WorkspaceApiRequest,
  parts: string[],
  repository: WorkspaceRepository,
  runtime: WorkspaceRuntimeSource | undefined,
): Promise<WorkspaceApiResponse> {
  const token = bearer(request), principal = token ? repository.findSession(token) : null;
  if (!principal) return { status: 401, body: { error: "UNAUTHENTICATED" } };
  const tenant = parts[2];
  if (tenant !== principal.tenantId || principal.role !== "owner") return { status: 403, body: { error: "PERMISSION_DENIED" } };
  const service = runtime?.gmailInbox;
  if (!service || !runtime) return { status: 404, body: { error: "GMAIL_INBOX_NOT_CONFIGURED" } };
  const owner = runtime.principalIdForSession(principal);
  if (owner !== service.owner || tenant !== service.scope.tenant) return { status: 403, body: { error: "GMAIL_INBOX_OWNER_DENIED" } };
  const live = () => {
    const p = token ? repository.findSession(token) : null;
    return !!p && p.tenantId === tenant && p.userId === principal.userId && p.role === "owner";
  };
  const done = (status: WorkspaceApiResponse["status"], body: Record<string, unknown>): WorkspaceApiResponse =>
    live() ? { status, body: { tenantId: tenant, ...body } } : { status: 401, body: { error: "UNAUTHENTICATED" } };
  const params = query(request.path);
  const body = request.method === "POST" ? record(request.body) : null;
  if (request.method === "POST" && !body) return { status: 400, body: { error: "INVALID_GMAIL_INBOX_REQUEST" } };
  const refInput = request.method === "GET" ? params.get("accountRef") : (body?.accountRef as unknown);
  if (refInput !== null && refInput !== undefined && (typeof refInput !== "string" || !REF.test(refInput)))
    return { status: 400, body: { error: "INVALID_ACCOUNT_REF" } };
  const accountRef = typeof refInput === "string" ? refInput : null;
  try {
    const ctx = await service.context(accountRef);
    if (accountRef !== null && !ctx.info) return done(404, { error: "GMAIL_INBOX_ACCOUNT_NOT_FOUND" });
    const publish = async (status: WorkspaceApiResponse["status"], response: Record<string, unknown>) => {
      const fresh = await service.context(accountRef);
      const before = contextOf(ctx), after = contextOf(fresh);
      if (before.tag !== after.tag || before.accountRef !== after.accountRef || before.revision !== after.revision)
        return done(409, { error: "GMAIL_INBOX_CONTEXT_CHANGED" });
      return done(status, response);
    };
    const sub = parts.slice(4);
    if (request.method === "GET" && sub.length === 0) return publish(200, { ...service.status(ctx) });
    if (request.method === "GET" && sub[0] === "messages" && (sub.length === 1 || sub.length === 2)) {
      if (!ctx.info) return publish(200, { items: [], nextCursor: null, context: contextOf(ctx) });
      if (!ctx.readable) return done(403, { error: "GMAIL_INBOX_ACCOUNT_NOT_ACTIVE" });
      if (sub.length === 2) {
        if (!GMAIL_ID.test(sub[1]!)) return done(400, { error: "INVALID_MESSAGE_ID" });
        const m = service.store.messageDetail(ctx.info.ns, sub[1]!);
        return m ? publish(200, { message: m, context: contextOf(ctx) }) : done(404, { error: "GMAIL_INBOX_MESSAGE_NOT_FOUND" });
      }
      const scope = (params.get("scope") ?? "inbox") as ListScope, q = params.get("q") ?? "", cursor = params.get("cursor");
      const limit = params.has("limit") ? Number(params.get("limit")) : 20;
      if (!["inbox", "sent", "archived"].includes(scope) || q.length > 100 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (cursor !== null && cursor.length > 512))
        return done(400, { error: "INVALID_GMAIL_INBOX_QUERY" });
      const page = service.store.listMessages(ctx.info.ns, { scope, query: q, cursor, limit });
      return publish(200, { ...page, context: contextOf(ctx) });
    }
    if (request.method === "POST" && sub.length === 1 && sub[0] === "sync") {
      if (Object.keys(body!).some(k => k !== "background") || (body!.background !== undefined && typeof body!.background !== "boolean")) return done(400, { error: "INVALID_GMAIL_INBOX_REQUEST" });
      const pending = service.syncNow(live);
      if (body!.background === true) {
        void pending.catch(() => undefined);
        return done(202, { accepted: true, ...service.status(await service.context(null)) });
      }
      const result = await pending;
      return done(result.outcome === "busy" ? 409 : 200, { result, ...service.status(await service.context(null)) });
    }
    if (request.method === "POST" && sub[0] === "purge" && sub.length === 2 && sub[1] === "prepare") {
      if (Object.keys(body!).some(k => k !== "accountRef")) return done(400, { error: "INVALID_GMAIL_INBOX_REQUEST" });
      if (!ctx.info) return done(404, { error: "GMAIL_INBOX_ACCOUNT_NOT_FOUND" });
      const t = service.createPurgeConfirmation(ctx.info);
      return done(200, { confirmationId: t.confirmationId, expiresAt: t.expiresAt, account: ctx.info.account, accountRef: ctx.info.accountRef, messageCount: ctx.info.messageCount });
    }
    if (request.method === "POST" && sub[0] === "purge" && sub.length === 1) {
      const keys = Object.keys(body!).sort().join(",");
      if (keys !== "accountRef,confirmationId,phrase" && keys !== "confirmationId,phrase") return done(400, { error: "INVALID_GMAIL_INBOX_REQUEST" });
      if (body!.phrase !== "BORRAR") return done(400, { error: "GMAIL_INBOX_PURGE_PHRASE_REQUIRED" });
      if (typeof body!.confirmationId !== "string") return done(400, { error: "INVALID_GMAIL_INBOX_REQUEST" });
      if (!ctx.info) return done(404, { error: "GMAIL_INBOX_ACCOUNT_NOT_FOUND" });
      await service.purge(ctx.info, body!.confirmationId, live);
      return done(200, { purged: true, ...service.status(await service.context(ctx.info.accountRef)) });
    }
    return { status: request.method === "GET" || request.method === "POST" ? 404 : 405, body: { error: "NOT_FOUND" } };
  } catch (error) {
    const code = error instanceof InboxStoreError ? error.message : "";
    if (code === "INBOX_AUTH_CHANGED") return { status: 401, body: { error: "UNAUTHENTICATED" } };
    if (code === "INBOX_CURSOR_INVALID" || code === "INBOX_LIST_INVALID") return done(400, { error: code });
    if (["INBOX_PURGE_CONFIRMATION_INVALID", "INBOX_PURGE_CONFIRMATION_STALE", "INBOX_SYNC_ACTIVE", "INBOX_NAMESPACE_NOT_OWNED"].includes(code))
      return done(409, { error: code });
    return done(409, { error: "GMAIL_INBOX_OPERATION_NOT_CONFIRMED" });
  }
}
