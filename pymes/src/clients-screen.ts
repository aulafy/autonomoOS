import { makeDemoData } from "./fixtures.js";
import { insuranceLines } from "./config.js";
const data = makeDemoData();
const list = document.querySelector<HTMLElement>("#clients-list")!;
const profile = document.querySelector<HTMLElement>("#clients-profile")!;
const search = document.querySelector<HTMLInputElement>("#clients-search")!;
const kind = document.querySelector<HTMLSelectElement>("#clients-kind")!;
let selected = data.contacts[0]?.id;
function node(tag: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}
function renderClients(): void {
  const query = search.value.trim().toLocaleLowerCase("es");
  const contacts = data.contacts.filter(contact =>
    (kind.value === "all" || contact.relationship === kind.value) &&
    (contact.name + " " + (contact.product ? insuranceLines[contact.product] : "")).toLocaleLowerCase("es").includes(query));
  if (!contacts.some(contact => contact.id === selected)) selected = contacts[0]?.id;
  list.replaceChildren();
  profile.replaceChildren();
  document.querySelector("#clients-results")!.textContent = `${contacts.length} contactos · Datos ficticios, sin sincronización CRM`;
  for (const contact of contacts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "client-row";
    button.setAttribute("aria-pressed", String(contact.id === selected));
    button.append(node("strong", contact.name), node("span", `${contact.relationship === "client" ? "Cliente" : "Oportunidad"} · ${contact.product ? insuranceLines[contact.product] : "Sin ramo"}`));
    button.addEventListener("click", () => { selected = contact.id; renderClients(); });
    list.append(button);
  }
  const contact = contacts.find(contact => contact.id === selected);
  if (!contact) { profile.append(node("h3", "No hay contactos que coincidan"), node("p", "Prueba con otro nombre o cambia el filtro.")); return; }
  profile.append(node("h3", contact.name), node("p", `Responsable: ${contact.owner}`), node("h4", "Conversaciones"));
  const seen = new Set<string>();
  for (const message of data.messages.filter(message => message.contactId === contact.id)) {
    if (seen.has(message.externalId)) continue;
    seen.add(message.externalId);
    profile.append(node("small", message.channel), node("p", message.text));
    const conversation = document.createElement("a");
    conversation.href = "#inbox";
    conversation.textContent = "Abrir esta conversación →";
    conversation.addEventListener("click", () => {
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("pymes:open-message", {
        detail: { externalId: message.externalId, channel: message.channel }
      })));
    });
    profile.append(conversation);
  }
  profile.append(node("h4", "Próxima cita"));
  const appointment = data.appointments.find(value => value.contactId === contact.id);
  profile.append(node("p", appointment ? `${appointment.title} · ${new Date(appointment.startsAt).toLocaleString("es-ES")}` : "Sin cita en la agenda de ejemplo"));
  const noteKey = `pymes:demo:contact-note:v1:${contact.id}`;
  const notes = document.createElement("form");
  notes.className = "client-notes";
  const label = document.createElement("label");
  label.htmlFor = "client-note";
  label.textContent = "Preparación de la próxima llamada";
  const textarea = document.createElement("textarea");
  textarea.id = "client-note";
  textarea.maxLength = 2000;
  textarea.rows = 4;
  textarea.placeholder = "Preguntas pendientes, documentos que pedir…";
  const status = node("p", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  try {
    textarea.value = (localStorage.getItem(noteKey) ?? "").slice(0, 2000);
    if (textarea.value) status.textContent = "Nota guardada en este navegador.";
  } catch { status.textContent = "El almacenamiento no está disponible."; }
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Guardar nota";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Borrar nota";
  remove.disabled = !textarea.value;
  textarea.addEventListener("input", () => {
    status.textContent = "Cambios sin guardar. Guarda antes de cambiar de cliente.";
    remove.disabled = !textarea.value;
  });
  notes.addEventListener("submit", event => {
    event.preventDefault();
    try {
      if (textarea.value.trim()) localStorage.setItem(noteKey, textarea.value.trim());
      else localStorage.removeItem(noteKey);
      status.textContent = "Nota guardada en este navegador. No se sincroniza con el CRM.";
    } catch { status.textContent = "No se pudo guardar. Copia la nota antes de salir."; }
  });
  remove.addEventListener("click", () => {
    try {
      localStorage.removeItem(noteKey);
      textarea.value = "";
      remove.disabled = true;
      status.textContent = "Nota borrada de este navegador.";
    } catch { status.textContent = "No se pudo borrar la nota guardada."; }
  });
  notes.append(label, node("small", "Notas locales de demostración · No introducir datos reales de clientes"), textarea, save, remove, status);
  profile.append(notes);
  const link = document.createElement("a");
  link.href = "#inbox";
  link.textContent = "Ir a la bandeja unificada →";
  profile.append(link);
}
search.addEventListener("input", renderClients);
kind.addEventListener("change", renderClients);
renderClients();
window.addEventListener("pymes:open-contact", event => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
  if (!data.contacts.some(contact => contact.id === event.detail)) return;
  selected = event.detail;
  search.value = "";
  kind.value = "all";
  renderClients();
  const heading = profile.querySelector<HTMLElement>("h3");
  if (heading) { heading.tabIndex = -1; heading.focus(); }
});
