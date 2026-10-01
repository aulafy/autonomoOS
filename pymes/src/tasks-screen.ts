import { makeDemoData } from "./fixtures.js";
import { buildMorningBrief, type Priority } from "./domain.js";
const data = makeDemoData();
const brief = buildMorningBrief(data);
const list = document.querySelector<HTMLElement>("#tasks-list")!;
const filters = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-task-filter]"));
let selected: Priority | "all" = "all";
const labels = { urgent: "Urgente", high: "Próximo", normal: "Normal" };
function renderTasks(): void {
  list.replaceChildren();
  const items = brief.items.filter(item => selected === "all" || item.priority === selected);
  document.querySelector("#tasks-count")!.textContent = `${items.length} solicitudes · La revisión y las acciones se realizan en la bandeja`;
  filters.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.taskFilter === selected)));
  if (!items.length) {
    list.textContent = "No hay solicitudes con esta prioridad.";
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
    copy.append(heading, context);
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
