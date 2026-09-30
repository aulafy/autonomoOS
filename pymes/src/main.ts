import { buildMorningBrief, type Channel, type Topic, type WorkItem } from "./domain.js";
import { makeDemoData } from "./fixtures.js";
import { insuranceLines, pilotConfig, type InsuranceLine } from "./config.js";
import { evaluateQuoteIntake, quoteRequirements } from "./quote-intake.js";
import { offersForCase, recordQuoteOffer, type OfferEntry, type QuoteOffer } from "./quote-offers.js";
import { createWorkspaceStore } from "./workspace-store.js";
import { WorkspaceClient, WorkspaceConflictError, type RemoteInboxRecord, type WorkspaceMetrics } from "./workspace-client.js";
import { MAX_EFFECT_RETRIES } from "./effects.js";
import { buildCallPlan } from "./call-plan.js";
import { acceptClassification, parseClassificationProposal,
  type ClassificationProposal } from "./classification.js";
import "./logout.css";
import "./retry.css";
import "./refresh.css";
import "./snapshot.css";
import "./remote-state.css";
import "./accessibility.css";
import { retryDelayMs } from "./retry-delay.js";

const demoMorning = new Date();
demoMorning.setHours(9, 0, 0, 0);
const demoData = makeDemoData(demoMorning);
let brief = buildMorningBrief(demoData);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tabs = $<HTMLDivElement>("channel-tabs");
const list = $<HTMLDivElement>("inbox-list");
const detail = $<HTMLElement>("detail");
const workspaceStore = createWorkspaceStore();
const review = workspaceStore.loadReviewIds(brief.items.filter(item =>
  item.identityStatus === "unidentified").map(item => item.id));
const modelSuggestions = new Map<string, { proposal: ClassificationProposal; model: string }>();
const quoteChecks = new Map<string, { line: InsuranceLine; checked: Set<string>;
  externalStepConfirmed: boolean }>();
const quoteOffers = workspaceStore.loadOffers();
let remoteWorkspaceClient: WorkspaceClient | null = null;
let remoteInbox = new Map<string, RemoteInboxRecord>();
let workspaceRetryTimer: number | null = null;
let workspaceSyncInFlight = false;
let workspaceAutoRefreshTimer: number | null = null;
const WORKSPACE_REFRESH_INTERVAL_MS = 60_000;
const WORKSPACE_METRICS_STALE_AFTER_MS = 5 * 60 * 1000;
let workspaceFailureCount = 0;

function renderWorkspaceMetrics(metrics: WorkspaceMetrics): void {
  const target = document.getElementById("workspace-metrics");
  if (!target) return;
  target.replaceChildren();
  const alertTarget = document.getElementById("workspace-alerts");
  if (alertTarget) {
    alertTarget.replaceChildren();
    for (const alert of metrics.alerts ?? []) {
      const item = document.createElement("span");
      item.className = `workspace-alert ${alert.severity}`;
      item.textContent = alert.code === "FAILED_EFFECTS"
        ? `${alert.count} operación${alert.count === 1 ? "" : "es"} fallida${alert.count === 1 ? "" : "s"}`
        : alert.code === "INBOX_BACKLOG"
          ? `${alert.count} casos pendientes de revisión`
          : `${alert.count} casos llevan más de 24 h pendientes`;
      alertTarget.appendChild(item);
    }
  }
  const failed = metrics.effects.byStatus.failed ?? 0;
  target.dataset.failed = String(failed);
  target.setAttribute("aria-label", failed > 0 ? `${failed} operaciones fallidas requieren revisión` : "Operativa sin operaciones fallidas");
  const rows: Array<[string, string]> = [
    ["Casos", String(metrics.inbox.total)],
    ["Pendientes", String(metrics.inbox.byState.pending_review ?? 0)],
    ["Operaciones activas", String((metrics.effects.byStatus.pending ?? 0) + (metrics.effects.byStatus.confirmed ?? 0))],
    ["Fallidas", String(metrics.effects.byStatus.failed ?? 0)],
    ["Aprobaciones", String(metrics.approvals.total)]
  ];
  for (const [label, value] of rows) {
    const item = document.createElement("div");
    const caption = document.createElement("span"); caption.textContent = label;
    const count = document.createElement("strong"); count.textContent = value;
    item.append(caption, count);
    target.appendChild(item);
  }
  target.dataset.updatedAt = metrics.generatedAt;
  const updated = document.getElementById("workspace-metrics-updated");
  if (updated) {
    const ageMs = Date.now() - Date.parse(metrics.generatedAt);
    const stale = ageMs > WORKSPACE_METRICS_STALE_AFTER_MS;
    updated.textContent = stale
      ? `Datos desactualizados · ${new Date(metrics.generatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
      : `Actualizado ${new Date(metrics.generatedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
    updated.dataset.stale = String(stale);
  }
  target.title = failed > 0 ? `${failed} operación${failed === 1 ? "" : "es"} fallida${failed === 1 ? "" : "s"}: revisar antes de reintentar` : "Sin operaciones fallidas";
}

let selectedChannel: Channel | "all" = "all";
const channelLabels: Record<Channel, string> = {
  whatsapp: "WhatsApp", telegram: "Telegram", imessage: "iMessage", email: "Correo"
};
let selectedId = brief.items[0]?.id ?? null;

async function checkRemoteWorkspace(): Promise<void> {
  if (workspaceSyncInFlight) return;
  const status = $("workspace-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.setAttribute("aria-busy", "true");
  const params = new URLSearchParams(window.location.search);
  const baseUrl = params.get("workspaceApi");
  const tenantId = params.get("tenant");
  const token = sessionStorage.getItem("pymes.workspace.token");
  if (!baseUrl || !tenantId || !token) {
    if (workspaceAutoRefreshTimer !== null) { window.clearInterval(workspaceAutoRefreshTimer); workspaceAutoRefreshTimer = null; }
    status.className = "workspace-pill error";
    status.dataset.state = "error";
    delete status.dataset.lastSync;
    delete status.dataset.connectorCount;
    delete status.dataset.failures;
    status.setAttribute("aria-busy", "false");
    return;
  }
  workspaceSyncInFlight = true;
  try {
    const client = new WorkspaceClient({ baseUrl, tenantId, token });
    const readiness = await client.ready();
    if (readiness.status !== "ok") {
      const unavailable = new Error("WORKSPACE_NOT_READY") as Error & { status: number; retryAfter: string };
      unavailable.status = 503;
      unavailable.retryAfter = readiness.retryAfter ?? "5s";
      throw unavailable;
    }
    const [approvals, inbox, connectors, metrics] = await Promise.all([client.approvals(), client.inbox(), client.connectors(), client.metrics()]);
    remoteWorkspaceClient = client;
    remoteInbox = new Map(inbox.map(item => [item.id, item]));
    renderWorkspaceMetrics(metrics);
    workspaceFailureCount = 0;
    status.dataset.connectorCount = String(connectors.length);
    delete status.dataset.failures;
    renderInbox();
    if (workspaceRetryTimer !== null) { window.clearTimeout(workspaceRetryTimer); workspaceRetryTimer = null; }
    if (workspaceAutoRefreshTimer === null) {
      workspaceAutoRefreshTimer = window.setInterval(() => { void checkRemoteWorkspace(); }, WORKSPACE_REFRESH_INTERVAL_MS);
    }
    status.className = "workspace-pill connected";
    status.dataset.state = "connected";
    status.dataset.lastSync = new Date().toISOString();
    document.getElementById("workspace-retry")?.remove();
    const syncedAt = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    status.textContent = `● WORKSPACE CONECTADO · v${readiness.version} · ${inbox.length} casos · ${approvals.length} aprobaciones · ${connectors.length} conectores · sync ${syncedAt}`;
    status.title = `Workspace ${readiness.service} versión ${readiness.version}. Última sincronización: ${status.dataset.lastSync}. Los casos y aprobaciones se leen del workspace remoto; los fixtures locales no se mezclan automáticamente.`;
    let logout = document.getElementById("workspace-logout") as HTMLButtonElement | null;
    if (!logout) {
      logout = document.createElement("button");
      logout.id = "workspace-logout";
      logout.type = "button";
      logout.className = "workspace-logout";
      logout.textContent = "Cerrar sesión";
      logout.setAttribute("aria-label", "Cerrar sesión del workspace remoto");
      logout.addEventListener("click", async () => {
        if (!remoteWorkspaceClient) return;
        logout!.disabled = true;
        logout!.setAttribute("aria-busy", "true");
        try { await remoteWorkspaceClient.revokeSession(); } finally {
          sessionStorage.removeItem("pymes.workspace.token");
          window.location.reload();
        }
      });
      status.parentElement?.appendChild(logout);
    }
    let refresh = document.getElementById("workspace-refresh") as HTMLButtonElement | null;
    if (!refresh) {
      refresh = document.createElement("button");
      refresh.id = "workspace-refresh";
      refresh.type = "button";
      refresh.className = "workspace-refresh";
      refresh.textContent = "Actualizar";
      refresh.setAttribute("aria-label", "Actualizar casos y aprobaciones del workspace");
      refresh.addEventListener("click", () => {
        refresh!.disabled = true;
        refresh!.setAttribute("aria-busy", "true");
        void checkRemoteWorkspace().finally(() => {
          const current = document.getElementById("workspace-refresh") as HTMLButtonElement | null;
          if (current) { current.disabled = false; current.removeAttribute("aria-busy"); }
        });
      });
      status.parentElement?.appendChild(refresh);
    }
    try { const effects = await client.effects(); $("effect-count").textContent = String(effects.filter(effect => effect.status === "pending" || effect.status === "confirmed" || effect.status === "failed").length); } catch { $("effect-count").textContent = "—"; }
    const selected = brief.items.find(item => item.id === selectedId);
    if (selected) renderDetail(selected);
  } catch (error: unknown) {
    document.getElementById("workspace-alerts")?.replaceChildren();
    const metricsUpdated = document.getElementById("workspace-metrics-updated");
    if (metricsUpdated && metricsUpdated.textContent !== "Sin sincronizar") {
      metricsUpdated.textContent = "Sin conexión · datos potencialmente desactualizados";
      metricsUpdated.dataset.stale = "true";
    }
    workspaceFailureCount = Math.min(workspaceFailureCount + 1, 999);
    status.className = "workspace-pill error";
    status.dataset.state = error instanceof Error && error.message === "WORKSPACE_NOT_READY" ? "starting" : "error";
    delete status.dataset.lastSync;
    delete status.dataset.connectorCount;
    status.dataset.failures = String(workspaceFailureCount);
    const requestId = error instanceof Error && "requestId" in error ? String((error as { requestId?: unknown }).requestId ?? "") : "";
    const httpStatus = error instanceof Error && "status" in error && typeof (error as { status?: unknown }).status === "number" ? String((error as { status: number }).status) : "";
    const retryAfter = error instanceof Error && "retryAfter" in error ? String((error as { retryAfter?: unknown }).retryAfter ?? "") : "";
    const retryHint = retryAfter ? `reintento sugerido en ${retryAfter}` : "";
    const detail = [httpStatus && `HTTP ${httpStatus}`, retryHint, requestId].filter(Boolean).join(" · ");
    const notReady = error instanceof Error && error.message === "WORKSPACE_NOT_READY";
    const failureHint = workspaceFailureCount > 1 ? ` · ${workspaceFailureCount} fallos consecutivos` : "";
    status.textContent = notReady ? `● WORKSPACE ARRANCANDO${detail ? ` · ${detail}` : ""}${failureHint}` : detail ? `● WORKSPACE NO DISPONIBLE · ${detail}${failureHint}` : `● WORKSPACE NO DISPONIBLE${failureHint}`;
    status.title = detail ? `Diagnóstico de soporte: ${detail}${failureHint}` : `El workspace remoto no está disponible.${failureHint}`;
    let retry = document.getElementById("workspace-retry") as HTMLButtonElement | null;
    if (!retry) {
      retry = document.createElement("button");
      retry.id = "workspace-retry";
      retry.type = "button";
      retry.className = "workspace-retry";
      retry.textContent = "Reintentar";
      retry.setAttribute("aria-label", "Reintentar conexión con el workspace");
      retry.addEventListener("click", () => { retry!.disabled = true; void checkRemoteWorkspace(); });
      status.parentElement?.appendChild(retry);
    }
    retry.disabled = false;
    retry.removeAttribute("aria-busy");
    remoteWorkspaceClient = null;
    document.getElementById("workspace-logout")?.remove();
    document.getElementById("workspace-refresh")?.remove();
    if (workspaceRetryTimer === null) {
      const retryAfter = error instanceof Error && "retryAfter" in error ? String((error as { retryAfter?: unknown }).retryAfter ?? "") : "";
      workspaceRetryTimer = window.setTimeout(() => {
        workspaceRetryTimer = null;
        void checkRemoteWorkspace();
      }, retryDelayMs(retryAfter));
    }
  } finally {
    status.setAttribute("aria-busy", "false");
    workspaceSyncInFlight = false;
  }
}

async function hashOffer(offer: QuoteOffer): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(offer));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

const channelNames: Record<Channel, string> = {
  whatsapp: "WhatsApp", telegram: "Telegram", imessage: "iMessage", email: "Correo" };
const topicNames: Record<Topic, string> = {
  incident: "Incidencia", quote: "Propuesta", renewal: "Renovación",
  appointment: "Cita", service: "Gestión", unknown: "Sin clasificar" };
const priorityNames = { urgent: "URGENTE", high: "PRÓXIMA", normal: "NORMAL" };
const effectStatusNames: Record<string, string> = { pending: "Pendiente", confirmed: "Confirmada", succeeded: "Realizada", failed: "Fallida" };
const effectKindNames: Record<string, string> = { call: "Llamada", calendar: "Cita", message: "Mensaje", crm_task: "Tarea CRM" };
const remoteStateNames: Record<string, string> = { pending_review: "Pendiente de revisión", approved: "Aprobado", executing: "En ejecución", completed: "Completado", failed: "Fallido" };
const contactName = (item: WorkItem) => item.contact?.name ?? "Contacto sin identificar";
const dayTime = (iso: string) => new Date(iso).toLocaleString("es-ES", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  timeZone: pilotConfig.timeZone });
const el = <K extends keyof HTMLElementTagNameMap>(tag: K,
  className = "", text = ""): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};

function renderCounts() {
  $("total-count").textContent = String(brief.counts.total);
  $("attention-count").textContent = String(brief.counts.urgent + brief.counts.high);
  $("unidentified-count").textContent = `${brief.counts.unidentified} sin identificar`;
  $("review-count").textContent = String(review.size);
  $("appointment-count").textContent = String(brief.appointments.length);
}

function renderTabs() {
  tabs.replaceChildren();
  const channelTabs: Array<[Channel | "all", string]> = [["all", "Todos"],
    ...pilotConfig.channels.map(channel => [channel, channelLabels[channel]] as [Channel, string])];
  for (const [channel, label] of channelTabs) {
    const count = channel === "all" ? brief.counts.total : brief.counts.byChannel[channel];
    const button = el("button", selectedChannel === channel ? "active" : "",
      `${label}  ${count}`);
    button.type = "button";
    button.setAttribute("aria-pressed", String(selectedChannel === channel));
    button.addEventListener("click", () => {
      selectedChannel = channel;
      renderTabs();
      renderInbox();
    });
    tabs.appendChild(button);
  }
}

function visibleItems(): WorkItem[] {
  const query = $<HTMLInputElement>("search").value.trim().toLocaleLowerCase("es");
  return brief.items.filter(item =>
    (selectedChannel === "all" || item.message.channel === selectedChannel) &&
    (!query || `${contactName(item)} ${item.message.text} ${topicNames[item.message.topic]} ${item.message.insuranceLine ? insuranceLines[item.message.insuranceLine] : ""}`
      .toLocaleLowerCase("es").includes(query)));
}

function renderInbox() {
  list.replaceChildren();
  const items = visibleItems();
  if (!items.length) {
    list.appendChild(el("div", "empty", "No hay conversaciones para este filtro."));
    return;
  }
  for (const item of items) {
    const button = el("button", `message-card${selectedId === item.id ? " active" : ""}`);
    button.type = "button";
    const head = el("div", "message-head");
    head.append(el("strong", "", contactName(item)),
      el("span", `priority ${item.priority}`, priorityNames[item.priority]));
    const meta = el("div", "message-meta");
    meta.append(el("span", "channel", channelNames[item.message.channel]),
      ...(item.identityStatus === "unidentified" ? [el("span", "identity-pending", "· Identidad pendiente")] : []),
      el("span", "", `· ${topicNames[item.message.topic]}`),
      el("span", "", `· ${item.message.insuranceLine ? insuranceLines[item.message.insuranceLine] : "Por clasificar"}`),
      el("span", "", `· ${dayTime(item.message.receivedAt)}`));
    const remote = remoteInbox.get(item.id);
    if (remote) {
      const remoteState = el("span", "remote-state", `· Workspace: ${remoteStateNames[remote.state] ?? remote.state} · v${remote.version ?? 0}`);
      remoteState.title = `Estado técnico: ${remote.state}; versión ${remote.version ?? 0}`;
      meta.append(remoteState);
      if (remote.sourceChannel && remote.sourceExternalMessageId) {
        const provenance = el("span", "remote-provenance", `· ${channelNames[remote.sourceChannel as Channel] ?? remote.sourceChannel}`);
        provenance.title = `Mensaje externo: ${remote.sourceExternalMessageId}`;
        meta.append(provenance);
      }
    }
    button.append(head, meta, el("p", "", item.message.text));
    button.addEventListener("click", () => {
      selectedId = item.id;
      renderInbox();
      renderDetail(item);
    });
    list.appendChild(button);
  }
}

function showItem(item: WorkItem) {
  selectedId = item.id;
  selectedChannel = "all";
  $<HTMLInputElement>("search").value = "";
  renderTabs();
  renderInbox();
  renderDetail(item);
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderReviewQueue() {
  const queue = $("review-list");
  queue.replaceChildren();
  const items = brief.items.filter(item => review.has(item.id));
  if (!items.length) {
    queue.appendChild(el("p", "queue-empty", "Selecciona una conversación para prepararla aquí."));
    return;
  }
  for (const item of items) {
    const row = el("div", "queue-row");
    const open = el("button", "queue-open", `${contactName(item)} · ${topicNames[item.message.topic]}`);
    open.type = "button";
    open.addEventListener("click", () => showItem(item));
    row.appendChild(open);
    row.appendChild(el("span", item.identityStatus === "unidentified" ? "queue-pending" : "queue-ready",
      item.identityStatus === "unidentified" ? "Identidad pendiente" : "Por revisar"));
    if (item.identityStatus === "linked") {
      const remove = el("button", "queue-remove", "Quitar");
      remove.type = "button";
      remove.setAttribute("aria-label", `Quitar a ${contactName(item)} de la cola`);
      remove.addEventListener("click", () => {
        review.delete(item.id);
        workspaceStore.saveReviewIds(review);
        renderCounts();
        renderReviewQueue();
        if (selectedId === item.id) renderDetail(item);
      });
      row.appendChild(remove);
    }
    queue.appendChild(row);
  }
}

function renderDetail(item: WorkItem) {
  detail.replaceChildren();
  const top = el("div", "detail-top");
  const identity = el("div");
  identity.append(el("span", "detail-label", topicNames[item.message.topic].toUpperCase()),
    el("h3", "", contactName(item)),
    el("p", "", `${item.contact ? item.contact.relationship === "client" ? "Cliente" : "Futuro cliente" : "Identidad pendiente"} · ${channelNames[item.message.channel]} · ${dayTime(item.message.receivedAt)}`));
  top.append(identity, el("span", `priority ${item.priority}`, priorityNames[item.priority]));
  detail.appendChild(top);

  if (remoteWorkspaceClient) {
    const trace = el("div", "detail-block", "CARGANDO TRAZABILIDAD DEL WORKSPACE…");
    detail.appendChild(trace);
    void remoteWorkspaceClient.audit(item.id).then(entries => {
      trace.replaceChildren(el("strong", "", `Trazabilidad · ${entries.length} transiciones`));
      const remote = remoteInbox.get(item.id);
      if (remote) {
        const snapshot = el("p", "workspace-snapshot", `Snapshot remoto · ${remoteStateNames[remote.state] ?? remote.state} · versión v${remote.version ?? 0}`);
        snapshot.title = `Estado técnico: ${remote.state}; versión ${remote.version ?? 0}`;
        trace.appendChild(snapshot);
        if (remote.sourceChannel && remote.sourceExternalMessageId) {
          const provenance = el("p", "workspace-provenance", `Origen del mensaje · ${channelNames[remote.sourceChannel as Channel] ?? remote.sourceChannel} · ${remote.sourceExternalMessageId}`);
          provenance.title = remote.sourceEventId ? `Evento OpenClaw: ${remote.sourceEventId}` : "Identificador externo del mensaje";
          trace.appendChild(provenance);
        }
      }
      if (!entries.length) trace.appendChild(el("p", "", "Todavía no hay cambios de estado registrados."));
      for (const entry of entries) trace.appendChild(el("p", "", `v${entry.version} · ${entry.from} → ${entry.to} · ${entry.operation} · ${entry.actorId}${entry.requestId ? ` · req ${entry.requestId}` : ""} · ${dayTime(entry.at)}`));
      const next = remote?.state === "pending_review" ? "approved" : remote?.state === "approved" ? "executing" : null;
      if (next) {
        const action = el("button", "review-button", next === "approved" ? "Aprobar caso" : "Iniciar ejecución");
        action.type = "button";
        action.addEventListener("click", async () => {
          action.disabled = true;
          try { await remoteWorkspaceClient!.transition(item.id, next, new Date().toISOString(), remote?.version); await checkRemoteWorkspace(); renderDetail(item); }
          catch (error) {
            if (error instanceof WorkspaceConflictError) {
              await checkRemoteWorkspace();
              action.disabled = false;
              action.textContent = `Caso actualizado a v${error.currentVersion}; revisar`;
              renderDetail(item);
              return;
            }
            action.disabled = false;
            action.textContent = error instanceof Error ? error.message : "No se pudo avanzar";
          }
        });
        trace.appendChild(action);
      }
    }).catch(() => { trace.textContent = "Trazabilidad no disponible para este caso."; });
    void remoteWorkspaceClient.effectsForCase(item.id).then(own => {
      const block = el("div", "detail-block");
      block.appendChild(el("strong", "", `Operaciones pendientes · ${own.length}`));
      if (!own.length) block.appendChild(el("p", "", "No hay efectos externos pendientes."));
      for (const effect of own) {
        block.appendChild(el("p", "", `${effectKindNames[effect.kind] ?? effect.kind} · ${effectStatusNames[effect.status] ?? effect.status} · solicitada por ${effect.requestedBy}`));
        if (effect.retryCount) block.appendChild(el("small", "", `Intentos de reejecución: ${effect.retryCount}`));
        block.appendChild(el("small", "", `Requiere confirmación explícita antes de ejecutar · ${dayTime(effect.requestedAt)}`));
        if (effect.executionNote) block.appendChild(el("p", "classification-reason", `Nota de ejecución: ${effect.executionNote}`));
        if (effect.executedBy && effect.executedAt) block.appendChild(el("small", "", `Registrada por ${effect.executedBy} · ${dayTime(effect.executedAt)}`));
        if (effect.status === "pending") {
          const confirm = el("button", "review-button", "Confirmar operación");
          confirm.type = "button";
          confirm.addEventListener("click", async () => {
            confirm.disabled = true;
            try { await remoteWorkspaceClient!.confirmEffect(effect.id); await checkRemoteWorkspace(); renderDetail(item); }
            catch (error) { confirm.disabled = false; confirm.textContent = error instanceof Error ? error.message : "No se pudo confirmar"; }
          });
          block.appendChild(confirm);
        }
        if (effect.status === "confirmed") {
          for (const result of ["succeeded", "failed"] as const) {
            const outcome = el("button", "review-button", result === "succeeded" ? "Registrar realizada" : "Registrar fallo");
            outcome.type = "button";
            outcome.addEventListener("click", async () => {
              const note = window.prompt("Nota obligatoria de ejecución:", "");
              if (!note?.trim()) return;
              outcome.disabled = true;
              try { await remoteWorkspaceClient!.reportEffectResult(effect.id, result, note); await checkRemoteWorkspace(); renderDetail(item); }
              catch (error) { outcome.disabled = false; outcome.textContent = error instanceof Error ? error.message : "No se pudo registrar"; }
            });
            block.appendChild(outcome);
          }
        }
        if (effect.status === "failed" && (effect.retryCount ?? 0) >= MAX_EFFECT_RETRIES) {
          block.appendChild(el("p", "classification-reason", "Límite de reintentos alcanzado. Requiere revisión manual."));
        }
        if (effect.status === "failed" && (effect.retryCount ?? 0) < MAX_EFFECT_RETRIES) {
          const retry = el("button", "review-button", "Reintentar operación");
          retry.type = "button";
          retry.addEventListener("click", async () => {
            const reason = window.prompt("Motivo obligatorio del reintento:", "");
            if (!reason?.trim()) return;
            retry.disabled = true;
            try { await remoteWorkspaceClient!.retryEffect(effect.id, reason); await checkRemoteWorkspace(); renderDetail(item); }
            catch (error) { retry.disabled = false; retry.textContent = error instanceof Error ? error.message : "No se pudo reintentar"; }
          });
          block.appendChild(retry);
        }
      }
      detail.insertBefore(block, source);
    }).catch(() => undefined);
  }

  const source = el("div", "detail-block");
  source.append(el("span", "", item.message.classificationSource === "human"
    ? "MENSAJE RECIBIDO · CLASIFICACIÓN CORREGIDA EN ESTA SESIÓN"
    : "MENSAJE RECIBIDO · DATO DE EJEMPLO"),
    el("div", "source-text", item.message.text));
  if (item.message.classificationReview) {
    source.appendChild(el("p", "classification-reason",
      `Motivo de corrección: ${item.message.classificationReview.reason}`));
  }
  detail.appendChild(source);
  if (item.message.reportedIncident && item.message.topic !== "incident") {
    detail.appendChild(el("div", "identity-warning",
      "La fuente comunicó una incidencia. El caso conserva prioridad urgente aunque se corrija la intención."));
  }

  const classification = el("details", "classification-review");
  classification.appendChild(el("summary", "", "Revisar intención y ramo"));
  classification.appendChild(el("p", "", "Corrige la clasificación de esta demo. El cambio no se envía al CRM ni al cliente."));
  const controls = el("div", "classification-controls");
  const topicLabel = el("label", "", "Intención");
  const topicSelect = el("select");
  for (const [value, label] of Object.entries(topicNames) as Array<[Topic, string]>) {
    const option = el("option", "", label);
    option.value = value;
    topicSelect.appendChild(option);
  }
  topicSelect.value = item.message.topic;
  topicLabel.appendChild(topicSelect);
  const lineLabel = el("label", "", "Ramo");
  const lineSelect = el("select");
  const none = el("option", "", "Por clasificar");
  none.value = "";
  lineSelect.appendChild(none);
  for (const [value, label] of Object.entries(insuranceLines)) {
    const option = el("option", "", label);
    option.value = value;
    lineSelect.appendChild(option);
  }
  lineSelect.value = item.message.insuranceLine ?? "";
  lineLabel.appendChild(lineSelect);
  const modelBox = el("div", "model-box");
  const requestProposal = el("button", "model-request", "Proponer con modelo local");
  requestProposal.type = "button";
  const modelStatus = el("div", "model-status");
  const showModelSuggestion = () => {
    modelStatus.replaceChildren();
    const suggestion = modelSuggestions.get(item.id);
    if (!suggestion) return;
    modelStatus.appendChild(el("p", "", `Propuesta no aceptada · ${suggestion.model}: ${topicNames[suggestion.proposal.topic]} · ${suggestion.proposal.insuranceLine ? insuranceLines[suggestion.proposal.insuranceLine] : "Ramo no identificado"}`));
    const copy = el("button", "model-copy", "Copiar a campos para revisar");
    copy.type = "button";
    copy.addEventListener("click", () => {
      topicSelect.value = suggestion.proposal.topic;
      lineSelect.value = suggestion.proposal.insuranceLine ?? "";
      reasonInput.focus();
    });
    modelStatus.appendChild(copy);
  };
  requestProposal.addEventListener("click", async () => {
    requestProposal.disabled = true;
    modelStatus.textContent = "Consultando el modelo local…";
    try {
      const response = await fetch(`/api/demo-classify/${encodeURIComponent(item.id)}`, {
        method: "POST", headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("MODEL_UNAVAILABLE");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new Error("INVALID_MODEL_RESULT");
      const result = data as Record<string, unknown>;
      if (result.messageId !== item.id || result.fixtureOnly !== true ||
        result.accepted !== false || typeof result.model !== "string") {
        throw new Error("INVALID_MODEL_RESULT");
      }
      modelSuggestions.set(item.id, { proposal: parseClassificationProposal(result.proposed),
        model: result.model });
      showModelSuggestion();
    } catch {
      modelStatus.textContent = "Modelo local no disponible. Puedes corregir manualmente.";
    } finally {
      requestProposal.disabled = false;
    }
  });
  modelBox.append(requestProposal, modelStatus);
  showModelSuggestion();
  const reasonLabel = el("label", "classification-reason-label", "Motivo de corrección");
  const reasonInput = el("textarea");
  reasonInput.rows = 2;
  reasonInput.maxLength = 240;
  reasonInput.placeholder = "Explica por qué cambias la clasificación…";
  reasonLabel.appendChild(reasonInput);
  const save = el("button", "classification-save", "Guardar corrección local");
  save.type = "button";
  save.disabled = true;
  reasonInput.addEventListener("input", () => {
    save.disabled = reasonInput.value.trim().length < 5;
  });
  save.addEventListener("click", () => {
    const proposal = parseClassificationProposal({ topic: topicSelect.value,
      insuranceLine: lineSelect.value || null });
    const index = demoData.messages.findIndex(message => message.id === item.id);
    if (index < 0) return;
    demoData.messages[index] = acceptClassification(demoData.messages[index]!, proposal,
      reasonInput.value, new Date().toISOString());
    modelSuggestions.delete(item.id);
    quoteChecks.delete(item.id);
    quoteOffers.delete(item.id);
    workspaceStore.saveOffers(quoteOffers);
    brief = buildMorningBrief(demoData);
    review.add(item.id);
    renderCounts();
    renderTabs();
    renderInbox();
    renderReviewQueue();
    const updated = brief.items.find(candidate => candidate.id === item.id);
    if (updated) renderDetail(updated);
  });
  controls.append(modelBox, topicLabel, lineLabel, reasonLabel, save);
  classification.appendChild(controls);
  detail.appendChild(classification);

  if (item.identityStatus === "unidentified") {
    detail.appendChild(el("div", "identity-warning",
      "Vinculación pendiente: este mensaje no está asociado a ningún expediente. Verifica la identidad antes de responder o cotizar."));
  }

  const action = el("div", "detail-block");
  action.append(el("span", "", "SIGUIENTE PASO PROPUESTO"),
    el("div", "next-action", item.nextAction),
    el("p", "source-text", item.reason));
  detail.appendChild(action);

  const draft = el("div", "detail-block");
  draft.append(el("span", "", "BORRADOR · NO ENVIADO"),
    el("div", "draft", item.draft));
  detail.appendChild(draft);

  const missing = el("div", "detail-block");
  missing.appendChild(el("span", "", item.message.topic === "quote"
    ? "DATOS A CONFIRMAR ANTES DE ACTUAR" : "DATOS QUE FALTAN ANTES DE ACTUAR"));
  const chips = el("div", "missing");
  for (const information of item.missingInformation) {
    chips.appendChild(el("span", "", information));
  }
  missing.appendChild(chips);
  detail.appendChild(missing);

  if (item.message.topic === "quote") {
    const intake = el("details", "quote-intake");
    intake.appendChild(el("summary", "", "Ficha de preparación de propuesta"));
    intake.appendChild(el("p", "", "Marca solo datos verificados. Esta ficha no calcula una prima ni genera condiciones de aseguradora."));
    const line = item.message.insuranceLine;
    if (line && quoteChecks.get(item.id)?.line !== line) {
      quoteChecks.set(item.id, { line, checked: new Set(), externalStepConfirmed: false });
    }
    const state = line ? quoteChecks.get(item.id)! : null;
    const checked = state?.checked ?? new Set<string>();
    const progress = el("p", "quote-progress");
    let offerButton: HTMLButtonElement | null = null;
    const updateProgress = () => {
      const result = evaluateQuoteIntake({ line,
        identityStatus: item.identityStatus, checkedIds: checked,
        externalStepConfirmed: state?.externalStepConfirmed });
      const statusText = result.status === "identity_required" ? "Verifica primero la identidad y el expediente." :
        result.status === "line_required" ? "Clasifica primero el ramo." :
          result.status === "collecting" ? "Información preliminar pendiente." :
            result.status === "external_step_required" ? "Información preliminar registrada; queda el paso externo de la aseguradora." :
              "Información preliminar registrada; falta consultar y revisar una oferta real.";
      progress.textContent = `${result.checked}/${result.total} datos verificados · ${statusText}`;
      if (offerButton) offerButton.disabled = result.status !== "preliminary_complete";
      return result.status;
    };
    if (line) {
      const fields = el("div", "quote-fields");
      for (const requirement of quoteRequirements[line]) {
        if (requirement.externalOnly) {
          fields.appendChild(el("p", "quote-external", `${requirement.label}. No introduzcas datos de salud en esta demo.`));
          const label = el("label", "quote-field quote-external-check");
          const checkbox = el("input") as HTMLInputElement;
          checkbox.type = "checkbox";
          checkbox.checked = state!.externalStepConfirmed;
          checkbox.disabled = item.identityStatus === "unidentified";
          checkbox.addEventListener("change", () => {
            state!.externalStepConfirmed = checkbox.checked;
            updateProgress();
          });
          label.append(checkbox, el("span", "", "Confirmo que el paso externo se completó en el canal de la aseguradora"));
          fields.appendChild(label);
          continue;
        }
        const label = el("label", "quote-field");
        const checkbox = el("input") as HTMLInputElement;
        checkbox.type = "checkbox";
        checkbox.checked = checked.has(requirement.id);
        checkbox.disabled = item.identityStatus === "unidentified";
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) checked.add(requirement.id);
          else checked.delete(requirement.id);
          updateProgress();
        });
        label.append(checkbox, el("span", "", requirement.label));
        fields.appendChild(label);
      }
      intake.appendChild(fields);
    }
    updateProgress();
    intake.appendChild(progress);

    if (line) {
      const offerSection = el("div", "offer-section");
      offerSection.appendChild(el("strong", "", "Ofertas recibidas de aseguradoras"));
      offerSection.appendChild(el("p", "", "Introduce solo datos de un documento real. La demo no verifica el documento ni recomienda una póliza."));
      const offerList = el("div", "offer-list");
      const renderOffers = () => {
        offerList.replaceChildren();
        const offers = offersForCase(quoteOffers.get(item.id) ?? [], item.id, line);
        if (!offers.length) {
          offerList.appendChild(el("p", "", "Todavía no hay ofertas registradas para este caso."));
          return;
        }
        for (const offer of offers) {
          const card = el("div", "offer-card");
          const premium = (offer.annualPremiumCents / 100).toLocaleString("es-ES", {
            style: "currency", currency: "EUR" });
          card.append(el("strong", "", `${offer.insurer} · ${premium}/año`),
            el("span", "", `Ref. ${offer.insurerReference} · Válida hasta ${offer.validUntil}`),
            el("p", "", `Cobertura declarada: ${offer.coverageSummary}`),
            el("p", "", `Exclusiones declaradas: ${offer.exclusionsSummary}`),
            el("small", "", `Fuente a comprobar: ${offer.sourceDocument} · Introducción manual, sin verificación automática`));
          if (remoteWorkspaceClient) {
            const approve = el("button", "offer-approve", "Solicitar aprobación en workspace");
            approve.type = "button";
            approve.addEventListener("click", async () => {
              approve.disabled = true;
              approve.textContent = "Registrando aprobación…";
              try {
                await remoteWorkspaceClient!.approve({ resourceId: offer.id,
                  reason: "Oferta revisada por el agente en PYMES/OS",
                  draftHash: await hashOffer(offer), approvedAt: new Date().toISOString() });
                approve.textContent = "Aprobación registrada ✓";
              } catch {
                approve.disabled = false;
                approve.textContent = "Reintentar aprobación";
              }
            });
            card.appendChild(approve);
          }
          offerList.appendChild(card);
        }
      };
      offerSection.appendChild(offerList);
      const form = el("form", "offer-form");
      const fields: Array<[keyof OfferEntry, string, string]> = [
        ["insurer", "Aseguradora", "text"],
        ["insurerReference", "Referencia de oferta", "text"],
        ["sourceDocument", "Documento o localizador de origen", "text"],
        ["annualPremium", "Prima anual en euros", "text"],
        ["validUntil", "Válida hasta", "date"],
        ["coverageSummary", "Coberturas según documento", "text"],
        ["exclusionsSummary", "Exclusiones según documento", "text"]
      ];
      const inputs = {} as Record<keyof OfferEntry, HTMLInputElement>;
      for (const [key, labelText, type] of fields) {
        const label = el("label", "", labelText);
        const input = el("input") as HTMLInputElement;
        input.type = type;
        input.required = true;
        input.name = key;
        if (key === "annualPremium") input.inputMode = "decimal";
        label.appendChild(input);
        form.appendChild(label);
        inputs[key] = input;
      }
      const error = el("p", "offer-error");
      offerButton = el("button", "offer-add", "Registrar oferta transcrita");
      offerButton.type = "submit";
      form.append(offerButton, error);
      form.addEventListener("submit", event => {
        event.preventDefault();
        try {
          const entry = Object.fromEntries(fields.map(([key]) => [key, inputs[key].value])) as unknown as OfferEntry;
          const offer = recordQuoteOffer({ id: `${item.id}-offer-${Date.now()}`,
            caseId: item.id, line, intakeStatus: updateProgress(), entry,
            enteredAt: new Date().toISOString() });
          const existing = quoteOffers.get(item.id) ?? [];
          offersForCase([...existing, offer], item.id, line);
          quoteOffers.set(item.id, [...existing, offer]);
          workspaceStore.saveOffers(quoteOffers);
          form.reset();
          error.textContent = "";
          renderOffers();
        } catch (cause) {
          error.textContent = cause instanceof Error && cause.message === "DUPLICATE_OFFER_REFERENCE"
            ? "Ya existe esa referencia para la aseguradora." : "Revisa la prima, fecha y los campos del documento original.";
        }
      });
      updateProgress();
      offerSection.appendChild(form);
      intake.appendChild(offerSection);
      renderOffers();
    }
    detail.appendChild(intake);
  }

  const plan = buildCallPlan(item, brief);
  const call = el("details", "call-plan");
  const summary = el("summary", "", plan.status === "identity_required"
    ? "Preparar verificación antes de llamar" : "Ver preparación de llamada");
  call.appendChild(summary);
  call.appendChild(el("p", "", plan.objective));
  const questions = el("ul");
  for (const question of plan.questions) questions.appendChild(el("li", "", question));
  call.appendChild(questions);
  if (plan.nextAppointment) {
    call.appendChild(el("p", "call-appointment",
      `Próxima cita: ${plan.nextAppointment.title} · ${dayTime(plan.nextAppointment.startsAt)} · ${plan.nextAppointment.state === "confirmed" ? "confirmada" : "propuesta"}`));
  }
  detail.appendChild(call);

  const crm = el("div", "crm-strip");
  for (const [label, value] of [["RELACIÓN", item.contact ? item.contact.relationship === "client" ? "Cliente" : "Prospecto" : "Sin vincular"],
    ["PRODUCTO", item.contact?.product ? insuranceLines[item.contact.product] : "Por definir"],
    ["RESPONSABLE", item.contact?.owner ?? "Por asignar"]]) {
    const field = el("div");
    field.append(el("span", "", label), el("strong", "", value));
    crm.appendChild(field);
  }
  detail.appendChild(crm);

  const bar = el("div", "review-bar");
  const note = el("small", "", `${item.message.classificationSource === "human" ? "Clasificación corregida localmente." : "La clasificación es de ejemplo."} Revisión humana obligatoria antes de responder, cotizar, reservar o modificar datos.`);
  const button = el("button", `review-button${review.has(item.id) ? " added" : ""}`,
    review.has(item.id) ? "En cola de revisión ✓" : "Añadir a revisión →");
  button.type = "button";
  button.disabled = review.has(item.id);
  button.addEventListener("click", () => {
    review.add(item.id);
    workspaceStore.saveReviewIds(review);
    renderCounts();
    renderReviewQueue();
    renderDetail(item);
  });
  bar.append(note, button);
  detail.appendChild(bar);
}

function renderAppointments() {
  const container = $("appointments");
  container.replaceChildren();
  for (const appointment of brief.appointments) {
    const date = new Date(appointment.startsAt);
    const row = el("div", "appointment");
    const tile = el("div", "date-tile");
    tile.append(el("strong", "", date.toLocaleDateString("es-ES", {
      day: "numeric", timeZone: pilotConfig.timeZone })),
      el("small", "", date.toLocaleDateString("es-ES", {
        month: "short", timeZone: pilotConfig.timeZone }).toUpperCase()));
    const copy = el("div");
    copy.append(el("strong", "", appointment.title),
      el("p", "", `${appointment.contactName} · ${date.toLocaleTimeString("es-ES", {
        hour: "2-digit", minute: "2-digit", timeZone: pilotConfig.timeZone })}`));
    row.append(tile, copy, el("span", "state", appointment.state === "confirmed"
      ? "Confirmada" : "Propuesta"));
    container.appendChild(row);
  }
}

$("today").textContent = new Date(brief.generatedAt).toLocaleDateString("es-ES", {
  weekday: "long", day: "numeric", month: "long", timeZone: pilotConfig.timeZone });
$("pilot-context").textContent = `${pilotConfig.country} · ${pilotConfig.crm.name}: ${pilotConfig.crm.status} · ${pilotConfig.calendar.name}: ${pilotConfig.calendar.status}`;
$("pilot-context").title = `Los conectores de ${pilotConfig.crm.name} y ${pilotConfig.calendar.name} están preparados para lectura. La autenticación y el estado operativo se gestionan en el workspace remoto.`;
$("pilot-context").setAttribute("aria-label", `${pilotConfig.country}. ${pilotConfig.crm.name}: ${pilotConfig.crm.status}. ${pilotConfig.calendar.name}: ${pilotConfig.calendar.status}. La autenticación y el estado operativo se gestionan en el workspace remoto.`);
$("pilot-context").dataset.crmStatus = pilotConfig.crm.status;
$("pilot-context").dataset.calendarStatus = pilotConfig.calendar.status;
$("pilot-context").dataset.crmId = pilotConfig.crm.id;
$("pilot-context").dataset.calendarId = pilotConfig.calendar.id;
$<HTMLInputElement>("search").addEventListener("input", renderInbox);
renderCounts();
renderTabs();
renderInbox();
if (brief.items[0]) renderDetail(brief.items[0]);
renderReviewQueue();
renderAppointments();
void checkRemoteWorkspace();
