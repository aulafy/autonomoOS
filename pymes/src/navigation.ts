const screenTitles: Record<string, string> = {
  "#morning": "Mi jornada",
  "#inbox": "Bandeja unificada",
  "#agenda": "Agenda",
  "#review-queue": "Cola de revisión",
  "#detail": "Preparación",
  "#clients-screen": "Clientes y oportunidades",
  "#tasks-screen": "Trabajo pendiente",
  "#installation": "Mi Mac mini",
  "#module-polizas": "Cartera",
  "#module-automatizaciones": "Automatizaciones",
  "#module-configuracion": "Configuración"
};
function navigate(focus = false): void {
  const hash = location.hash || "#morning";
  const title = screenTitles[hash] ?? "Mi jornada";
  document.body.classList.toggle("installation-view", hash === "#installation");
  document.body.classList.toggle("clients-view", hash === "#clients-screen");
  document.body.classList.toggle("tasks-view", hash === "#tasks-screen");
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
  if (focus && ["#installation", "#clients-screen", "#tasks-screen"].includes(hash)) {
    const heading = document.getElementById(hash.slice(1))?.querySelector<HTMLElement>("h2");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0 });
  }
}
window.addEventListener("hashchange", () => navigate(true));
navigate();
