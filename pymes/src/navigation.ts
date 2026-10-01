const screenTitles: Record<string, string> = {
  "#morning": "Mi jornada",
  "#help-screen": "Ayuda",
  "#inbox": "Bandeja unificada",
  "#agenda": "Agenda",
  "#review-queue": "Cola de revisión",
  "#detail": "Preparación",
  "#clients-screen": "Clientes y oportunidades",
  "#tasks-screen": "Trabajo pendiente",
  "#installation": "Mi Mac mini",
  "#portfolio-screen": "Cartera de pólizas",
  "#automation-screen": "Reglas de preparación",
  "#settings-screen": "Configuración"
};
function navigate(focus = false): void {
  const hash = location.hash || "#morning";
  const title = screenTitles[hash] ?? "Mi jornada";
  document.body.classList.toggle("installation-view", hash === "#installation");
  document.body.classList.toggle("clients-view", hash === "#clients-screen");
  document.body.classList.toggle("tasks-view", hash === "#tasks-screen");
  document.body.classList.toggle("help-view", hash === "#help-screen");
  document.body.classList.toggle("automation-view", hash === "#automation-screen");
  document.body.classList.toggle("portfolio-view", hash === "#portfolio-screen");
  document.body.classList.toggle("settings-view", hash === "#settings-screen");
  document.body.classList.toggle("agenda-view", hash === "#agenda");
  const breadcrumb = document.querySelector("#current-screen-title");
  if (breadcrumb) breadcrumb.textContent = title;
  document.title = `${title} · PYMES / OS`;
  document.querySelectorAll<HTMLAnchorElement>(".sidebar nav a").forEach(link => {
    const active = link.hash === hash;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
    // Give icon-only navigation a full name at compact viewport widths.
    const label = link.querySelector("span")?.textContent;
    if (label) { link.setAttribute("aria-label", label); link.title = label; }
  });
  if (focus && ["#installation", "#clients-screen", "#tasks-screen", "#help-screen", "#automation-screen", "#portfolio-screen", "#settings-screen", "#agenda"].includes(hash)) {
    const heading = document.getElementById(hash.slice(1))?.querySelector<HTMLElement>("h2");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0 });
  }
}
window.addEventListener("hashchange", () => navigate(true));
navigate();

const navigationDialog = document.querySelector<HTMLDialogElement>("#navigation-search")!;
const navigationInput = document.querySelector<HTMLInputElement>("#navigation-search-input")!;
const navigationResults = document.querySelector<HTMLElement>("#navigation-search-results")!;
const destinations = [
  ["#morning", "Mi jornada"], ["#inbox", "Bandeja unificada"],
  ["#clients-screen", "Clientes y oportunidades"], ["#tasks-screen", "Trabajo pendiente"],
  ["#agenda", "Agenda"], ["#review-queue", "Cola de revisión"],
  ["#installation", "Mi Mac mini"], ["#help-screen", "Ayuda"], ["#automation-screen", "Reglas de preparación"], ["#portfolio-screen", "Cartera de pólizas"], ["#settings-screen", "Configuración"]
];
function filterNavigation(): void {
  navigationResults.replaceChildren();
  const query = navigationInput.value.trim().toLocaleLowerCase("es");
  const matches = destinations.filter(([, label]) => label!.toLocaleLowerCase("es").includes(query));
  for (const [hash, label] of matches) {
    const link = document.createElement("a");
    link.href = hash!;
    link.textContent = label!;
    link.addEventListener("click", () => navigationDialog.close());
    navigationResults.append(link);
  }
  if (!matches.length) {
    navigationResults.textContent = "No hay secciones que coincidan.";
  }
}
function openNavigation(): void {
  if (navigationDialog.open) return;
  navigationInput.value = "";
  filterNavigation();
  navigationDialog.showModal();
  navigationInput.focus();
}
document.querySelector("#navigation-search-open")?.addEventListener("click", openNavigation);
document.querySelector("#navigation-search-close")?.addEventListener("click", () => navigationDialog.close());
navigationInput.addEventListener("input", filterNavigation);
navigationInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    const first = navigationResults.querySelector<HTMLAnchorElement>("a");
    if (first) { event.preventDefault(); first.click(); }
  }
});
window.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openNavigation();
  }
});
