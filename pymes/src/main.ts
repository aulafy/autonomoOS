import { buildMorningBrief, type Channel, type WorkItem } from "./domain.js";
import { makeDemoData } from "./fixtures.js";
import { insuranceLines, pilotConfig } from "./config.js";
import { buildCallPlan } from "./call-plan.js";

const demoMorning = new Date();
demoMorning.setHours(9, 0, 0, 0);
const brief = buildMorningBrief(makeDemoData(demoMorning));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tabs = $<HTMLDivElement>("channel-tabs");
const list = $<HTMLDivElement>("inbox-list");
const detail = $<HTMLElement>("detail");
const review = new Set<string>(brief.items.filter(item =>
  item.identityStatus === "unidentified").map(item => item.id));
let selectedChannel: Channel | "all" = "all";
let selectedId = brief.items[0]?.id ?? null;

const channelNames: Record<Channel, string> = {
  whatsapp: "WhatsApp", telegram: "Telegram", imessage: "iMessage", email: "Correo" };
const topicNames: Record<string, string> = {
  incident: "Incidencia", quote: "Propuesta", renewal: "Renovación",
  appointment: "Cita", service: "Gestión" };
const priorityNames = { urgent: "URGENTE", high: "PRÓXIMA", normal: "NORMAL" };
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
  for (const [channel, label] of [["all", "Todos"],
    ["whatsapp", "WhatsApp"], ["telegram", "Telegram"],
    ["imessage", "iMessage"], ["email", "Correo"]] as const) {
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

  const source = el("div", "detail-block");
  source.append(el("span", "", "MENSAJE RECIBIDO · DATO DE EJEMPLO"),
    el("div", "source-text", item.message.text));
  detail.appendChild(source);

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
  missing.appendChild(el("span", "", "DATOS QUE FALTAN ANTES DE ACTUAR"));
  const chips = el("div", "missing");
  for (const information of item.missingInformation) {
    chips.appendChild(el("span", "", information));
  }
  missing.appendChild(chips);
  detail.appendChild(missing);

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
  const note = el("small", "", "La clasificación es de ejemplo. Revisión humana obligatoria antes de responder, cotizar, reservar o modificar datos.");
  const button = el("button", `review-button${review.has(item.id) ? " added" : ""}`,
    review.has(item.id) ? "En cola de revisión ✓" : "Añadir a revisión →");
  button.type = "button";
  button.disabled = review.has(item.id);
  button.addEventListener("click", () => {
    review.add(item.id);
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
$("pilot-context").textContent = `${pilotConfig.country} · ${pilotConfig.crm.name} por conectar · ${pilotConfig.calendar.name} por conectar`;
$<HTMLInputElement>("search").addEventListener("input", renderInbox);
renderCounts();
renderTabs();
renderInbox();
if (brief.items[0]) renderDetail(brief.items[0]);
renderReviewQueue();
renderAppointments();
