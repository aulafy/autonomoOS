type Scenario = "move" | "speak" | "deny";
type TraceEvent = { type: string; at: number; detail: string | null };
type Effect = { id: string; taskId: string; action: string; status: string;
  taskEvents: TraceEvent[]; observations: Array<{ status: string; at: number;
    source: string }>; reservationStatuses: string[] };
type Denial = { type: string; at: number; taskId: string | null;
  reasonCode: string | null };
type Snapshot = { effects: Effect[]; denials: Denial[] };

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const connection = el<HTMLDivElement>("connection");
const tourButton = el<HTMLButtonElement>("run-tour");
const tourStatus = el<HTMLDivElement>("tour-status");
const effectList = el<HTMLDivElement>("effect-list");
const effectDetail = el<HTMLDivElement>("effect-detail");
const denialList = el<HTMLDivElement>("denial-list");
const scenarioButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".scenario-button"));
const requestedPort = Number(new URLSearchParams(location.search).get("runtimePort") ?? "8787");
const runtimePort = Number.isInteger(requestedPort) && requestedPort > 0 &&
  requestedPort < 65536 ? requestedPort : 8787;
const socket = new WebSocket(`ws://127.0.0.1:${runtimePort}`);
const pending = new Map<string, Scenario>();
let snapshot: Snapshot = { effects: [], denials: [] };
let selectedEffectId: string | null = null;
let tourIndex = -1;
const tourSteps: Scenario[] = ["move", "speak", "deny"];
window.addEventListener("error", event => {
  tourStatus.textContent = `Error de interfaz: ${event.message}`;
});

const labels: Record<string, string> = {
  "action.proposed": "Acción solicitada", "effect.prepared": "Efecto preparado",
  "action.admitted": "Admisión aprobada", "action.commit_allowed": "Ejecución autorizada",
  "effect.dispatching": "Acción en ejecución", "effect.dispatch_reported": "Ejecución comunicada",
  "effect.committed": "Efecto confirmado", "effect.unknown": "Resultado incierto",
  "effect.failed": "Efecto fallido", "plan.proposed": "Plan propuesto",
  "plan.accepted": "Plan aceptado", "inference.requested": "Consulta al modelo",
  "inference.completed": "Respuesta del modelo"
};
const actionLabels: Record<string, string> = {
  goto: "Desplazamiento a la sala", say: "Comunicación de Astra",
  "api.create_record": "Registro externo", "file.write": "Escritura de archivo",
  "file.read": "Lectura de archivo", use_tool: "Uso de herramienta"
};
const time = (value: number) => new Date(value).toLocaleTimeString("es-ES", {
  hour: "2-digit", minute: "2-digit", second: "2-digit" });

function setConnected(connected: boolean) {
  connection.classList.toggle("offline", !connected);
  connection.lastChild!.textContent = connected ? " Runtime conectado" : " Runtime desconectado";
  tourButton.disabled = !connected || tourIndex >= 0;
  for (const button of scenarioButtons) button.disabled = !connected || tourIndex >= 0;
  if (!connected) tourStatus.textContent = "Inicia el runtime local para usar la demo.";
}

function send(message: unknown): boolean {
  if (socket.readyState !== WebSocket.OPEN) {
    setConnected(false);
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}

function intentFor(scenario: Scenario) {
  const id = globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
      const value = Math.floor(Math.random() * 16);
      return (character === "x" ? value : (value & 3) | 8).toString(16);
    });
  const base = { id, actorId: "astra",
    provenance: { source: "human" } };
  switch (scenario) {
    case "move": return { ...base, action: "goto", targetId: "meeting_room",
      parameters: {} };
    case "speak": return { ...base, action: "say",
      parameters: { text: "Astra lista para colaborar con el equipo." } };
    case "deny": return { ...base, action: "purchase_compute",
      parameters: { units: 100 } };
  }
}

function runScenario(scenario: Scenario) {
  const intent = intentFor(scenario);
  if (!send({ type: "action.intent", intent })) return;
  pending.set(intent.id, scenario);
  const result = el<HTMLDivElement>(`result-${scenario}`);
  result.className = "scenario-result";
  result.textContent = "Comprobando controles…";
  tourStatus.textContent = `Ejecutando caso ${tourIndex >= 0 ? tourIndex + 1 : "individual"}: ${scenario === "move" ? "desplazamiento" : scenario === "speak" ? "comunicación" : "bloqueo"}.`;
}

function advanceTour() {
  tourIndex++;
  if (tourIndex >= tourSteps.length) {
    tourIndex = -1;
    tourStatus.textContent = "Recorrido completo. La evidencia queda disponible abajo y persiste al actualizar.";
    setConnected(socket.readyState === WebSocket.OPEN);
    return;
  }
  runScenario(tourSteps[tourIndex]);
}

function renderEffects() {
  const effects = Array.isArray(snapshot.effects) ? snapshot.effects : [];
  el<HTMLElement>("metric-confirmed").textContent = String(effects.filter(e => e.status === "committed").length);
  el<HTMLElement>("metric-unknown").textContent = String(effects.filter(e => e.status === "unknown").length);
  el<HTMLElement>("effect-count").textContent = String(effects.length);
  if (tourIndex < 0) for (const [scenario, action] of [["move", "goto"],
    ["speak", "say"]] as const) {
    const result = el<HTMLDivElement>(`result-${scenario}`);
    if (result.textContent === "Pendiente" &&
      effects.some(effect => effect.action === action && effect.status === "committed")) {
      result.className = "scenario-result success";
      result.textContent = "✓ Última ejecución confirmada";
    }
  }
  effectList.replaceChildren();
  if (!effects.length) {
    effectList.innerHTML = '<div class="empty">Esperando acciones verificables…</div>';
    effectDetail.textContent = "Selecciona una acción para ver su recorrido.";
    return;
  }
  if (!selectedEffectId || !effects.some(effect => effect.id === selectedEffectId)) {
    selectedEffectId = effects[0].id;
  }
  for (const effect of effects) {
    const button = document.createElement("button");
    button.className = `effect-item${effect.id === selectedEffectId ? " active" : ""}`;
    const title = document.createElement("strong");
    const name = document.createElement("span");
    name.textContent = actionLabels[effect.action] ?? effect.action;
    const badge = document.createElement("span");
    badge.className = `pill ${effect.status}`;
    badge.textContent = effect.status === "committed" ? "CONFIRMADA" :
      effect.status === "unknown" ? "INCIERTA" : effect.status.toUpperCase();
    title.append(name, badge);
    const id = document.createElement("small");
    id.textContent = `Efecto ${effect.id.slice(0, 12)} · tarea ${effect.taskId.slice(0, 8)}`;
    button.append(title, id);
    button.addEventListener("click", () => {
      selectedEffectId = effect.id;
      renderEffects();
    });
    effectList.appendChild(button);
  }
  renderDetail(effects.find(effect => effect.id === selectedEffectId)!);
}

function renderDetail(effect: Effect) {
  effectDetail.replaceChildren();
  const trace = document.createElement("div");
  trace.className = "trace";
  const entries = [...(effect.taskEvents ?? [])];
  for (const observation of effect.observations ?? []) entries.push({
    type: `observation.${observation.status}`, at: observation.at,
    detail: `Fuente: ${observation.source}` });
  if (!entries.length) {
    effectDetail.textContent = "Aún no hay eventos visibles para este efecto.";
    return;
  }
  for (const event of entries) {
    const row = document.createElement("div");
    row.className = "trace-row";
    const track = document.createElement("span");
    track.className = "trace-track";
    const description = document.createElement("div");
    description.textContent = labels[event.type] ?? (event.type.startsWith("observation.")
      ? "Resultado observado" : event.type);
    if (event.detail) {
      const detail = document.createElement("span");
      detail.className = "trace-detail";
      detail.textContent = event.detail === "allow / not_required"
        ? "Política permitida · flujo no requerido"
        : event.detail === "durable dispatch marker"
          ? "Marca persistente antes de ejecutar"
          : event.detail === "Fuente: world" ? "Fuente: mundo simulado"
            : event.detail;
      description.appendChild(detail);
    }
    const timestamp = document.createElement("small");
    timestamp.textContent = time(event.at);
    row.append(track, description, timestamp);
    trace.appendChild(row);
  }
  effectDetail.appendChild(trace);
}

function renderDenials() {
  const denials = Array.isArray(snapshot.denials) ? snapshot.denials : [];
  el<HTMLElement>("metric-denied").textContent = String(denials.length);
  el<HTMLElement>("denial-count").textContent = String(denials.length);
  const deniedResult = el<HTMLDivElement>("result-deny");
  if (tourIndex < 0 && deniedResult.textContent === "Pendiente" &&
    denials.some(denial => denial.reasonCode === "DEMO_ACTION_NOT_REGISTERED")) {
    deniedResult.className = "scenario-result denied";
    deniedResult.textContent = "⊘ Última solicitud bloqueada";
  }
  denialList.replaceChildren();
  if (!denials.length) {
    denialList.innerHTML = '<div class="empty">No hay denegaciones recientes.</div>';
    return;
  }
  for (const denial of denials) {
    const row = document.createElement("div");
    row.className = "denial-item";
    const title = document.createElement("strong");
    title.textContent = denial.reasonCode === "DEMO_ACTION_NOT_REGISTERED"
      ? "Solicitud fuera de las acciones permitidas" : "Solicitud bloqueada";
    const detail = document.createElement("small");
    detail.textContent = `${denial.reasonCode ?? "Motivo no disponible"} · ${time(denial.at)}`;
    row.append(title, detail);
    denialList.appendChild(row);
  }
}

tourButton.addEventListener("click", () => {
  tourStatus.textContent = "Iniciando recorrido…";
  tourIndex = -1;
  setConnected(true);
  advanceTour();
  setConnected(true);
});
for (const button of scenarioButtons) button.addEventListener("click", () =>
  runScenario(button.dataset.action as Scenario));

socket.addEventListener("open", () => {
  setConnected(true);
  tourStatus.textContent = "Demo lista. Ejecuta un caso o inicia el recorrido completo.";
  send({ type: "control.snapshot.request" });
});
socket.addEventListener("close", () => setConnected(false));
socket.addEventListener("error", () => setConnected(false));
socket.addEventListener("message", event => {
  let message: any;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === "control.snapshot") {
    snapshot = message.snapshot;
    renderEffects();
    renderDenials();
  }
  if (message.type === "action.result") {
    const scenario = pending.get(message.result?.intentId);
    if (!scenario) return;
    pending.delete(message.result.intentId);
    const result = el<HTMLDivElement>(`result-${scenario}`);
    const observed = message.result.status === "observed";
    const denied = message.result.status === "denied";
    result.className = `scenario-result ${observed ? "success" : denied ? "denied" : "error"}`;
    result.textContent = observed ? "✓ Ejecutada y observada" : denied
      ? `⊘ Bloqueada · ${message.result.reason ?? "sin autorización"}`
      : `Resultado: ${message.result.status ?? "desconocido"}`;
    send({ type: "control.snapshot.request" });
    if (tourIndex >= 0) window.setTimeout(advanceTour, 650);
    else tourStatus.textContent = "Caso completado. Revisa la evidencia persistente abajo.";
  }
  if (message.type === "runtime.error") {
    tourStatus.textContent = `Error del runtime: ${String(message.error ?? "desconocido")}`;
    tourIndex = -1;
    setConnected(socket.readyState === WebSocket.OPEN);
  }
});
window.setInterval(() => {
  if (socket.readyState === WebSocket.OPEN) send({ type: "control.snapshot.request" });
}, 2500);
