import { normalizeSearch as normalize } from "./search.js";
import { demoData as data } from "./demo-data.js";
import { buildMorningBrief, type Priority } from "./domain.js";

const list = document.querySelector<HTMLElement>("#tasks-list")!;
const filters = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-task-filter]"));
const search = document.querySelector<HTMLInputElement>("#tasks-search")!;
const insuranceLine = document.querySelector<HTMLSelectElement>("#tasks-line")!;
const lineLabels: Record<string, string> = { auto: "Coche", life: "Vida", home: "Hogar", selfEmployedLiability: "RC de autónomos" };
let selected: Priority | "all" = "all";
const labels = { urgent: "Urgente", high: "Próximo", normal: "Normal" };
function renderTasks(): void {
  list.replaceChildren();
  list.classList.remove("tasks-empty");
  const brief = buildMorningBrief(data);
  const query = normalize(search.value.trim());
  const items = brief.items.filter(item =>
    (selected === "all" || item.priority === selected) &&
    (insuranceLine.value === "all" || (item.message.insuranceLine ?? "unknown") === insuranceLine.value) &&
    (!query || normalize(`${item.contact?.name ?? "Contacto sin identificar"} ${item.nextAction} ${item.message.text} ${item.reason}`).includes(query)));

  document.querySelector("#tasks-count")!.textContent = `${items.length} de ${brief.items.length} solicitudes · Revisa las acciones en la bandeja`;
  filters.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.taskFilter === selected)));
  if (!items.length) {
    list.classList.add("tasks-empty");
    list.textContent = "No hay solicitudes que coincidan. Prueba otro ramo, prioridad o búsqueda.";
    return;
  }
  for (const item of items) {
    const row = document.createElement("article");
    row.className = "task-row";
    const badge = document.createElement("span");
    badge.className = `priority ${item.priority}`;
    badge.textContent = labels[item.priority];
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = item.nextAction;
    const context = document.createElement("p");
    context.textContent = `${item.contact?.name ?? "Contacto sin identificar"} · ${item.reason}`;
    const line = document.createElement("span");
    line.className = "task-insurance-line";
    line.textContent = lineLabels[item.message.insuranceLine ?? ""] ?? "Ramo sin determinar";
    copy.append(heading, context, line);
    const link = document.createElement("a");
    link.href = "#inbox";
    link.textContent = "Revisar →";
    link.setAttribute("aria-label", `Revisar solicitud de ${item.contact?.name ?? "contacto sin identificar"}`);
    link.addEventListener("click", () => requestAnimationFrame(() => window.dispatchEvent(
      new CustomEvent("pymes:open-message", { detail: { externalId: item.message.externalId, channel: item.message.channel } })
    )));
    row.append(badge, copy, link);
    list.append(row);
  }
}
filters.forEach(button => button.addEventListener("click", () => {
  const value = button.dataset.taskFilter;
  if (value !== "all" && value !== "urgent" && value !== "high" && value !== "normal") return;
  selected = value;
  renderTasks();
}));
renderTasks();

search.addEventListener("input", renderTasks);
insuranceLine.addEventListener("change", renderTasks);
document.querySelector("#tasks-reset")!.addEventListener("click", () => {
  selected = "all";
  search.value = "";
  insuranceLine.value = "all";
  renderTasks();
  search.focus();
});
window.addEventListener("hashchange", () => {
  if (location.hash === "#tasks-screen") renderTasks();
});
