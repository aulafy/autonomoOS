// A manual installation checklist, never a provider connectivity claim.
const setupKey = "pymes:appliance:setup:v1";
const checklist = document.querySelector<HTMLElement>("#setup-checklist");
const inputs = Array.from(checklist?.querySelectorAll<HTMLInputElement>("input[type=checkbox]") ?? []);
const progress = document.querySelector<HTMLProgressElement>("#setup-progress");
const count = document.querySelector<HTMLElement>("#setup-count");
const feedback = document.querySelector<HTMLElement>("#setup-feedback");
try {
  const stored: unknown = JSON.parse(localStorage.getItem(setupKey) ?? "[]");
  if (Array.isArray(stored)) inputs.forEach(input => { input.checked = stored.includes(input.value); });
} catch { /* An unavailable storage area leaves the checklist usable in this session. */ }
function updateSetup(): void {
  const selected = inputs.filter(input => input.checked).map(input => input.value);
  if (progress) progress.value = selected.length;
  if (count) count.textContent = `${selected.length} de ${inputs.length} pasos revisados`;
  const state = document.querySelector<HTMLElement>("#setup-state");
  if (state) {
    state.textContent = selected.length === inputs.length ? "Revisión manual completada" : "Preparación pendiente";
    state.classList.toggle("complete", selected.length === inputs.length);
  }
  try {
    localStorage.setItem(setupKey, JSON.stringify(selected));
    if (feedback) feedback.textContent = "Lista guardada en este navegador.";
  } catch {
    if (feedback) feedback.textContent = "Lista disponible solo durante esta sesión.";
  }
}
inputs.forEach(input => input.addEventListener("change", updateSetup));
document.querySelector("#setup-reset")?.addEventListener("click", () => {
  inputs.forEach(input => { input.checked = false; });
  updateSetup();
});
updateSetup();

function navigateWorkspace(): void {
  const installation = location.hash === "#installation";
  document.body.classList.toggle("installation-view", installation);
  document.querySelectorAll<HTMLAnchorElement>(".sidebar nav a").forEach(link => {
    const active = link.hash === (location.hash || "#morning");
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (installation) {
    const heading = document.querySelector<HTMLElement>("#installation h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  }
}
window.addEventListener("hashchange", navigateWorkspace);
navigateWorkspace();
