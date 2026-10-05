const screenTitles: Record<string, string> = {
  "#capsules-screen": "Mi Autónomo OS",
  "#gmail-inbox": "Correo Gmail",
  "#runtime-screen": "Centro de agentes",
  "#morning": "Inicio",
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
  const capsuleDetail = hash.startsWith('#capsule-');
  const title = screenTitles[hash] ?? (capsuleDetail ? 'Cápsula' : "Inicio");
  document.body.classList.toggle("morning-view", hash === "#morning" || (!screenTitles[hash] && !capsuleDetail));
  document.body.classList.toggle('capsules-view', hash === '#capsules-screen');
  document.body.classList.toggle('capsule-detail-view', capsuleDetail);
  setMenuOpen(false);
  document.body.classList.toggle("runtime-view", hash === "#runtime-screen");
  document.body.classList.toggle("installation-view", hash === "#installation");
  document.body.classList.toggle("clients-view", hash === "#clients-screen");
  document.body.classList.toggle("tasks-view", hash === "#tasks-screen");
  document.body.classList.toggle("help-view", hash === "#help-screen");
  document.body.classList.toggle("automation-view", hash === "#automation-screen");
  document.body.classList.toggle("portfolio-view", hash === "#portfolio-screen");
  document.body.classList.toggle("settings-view", hash === "#settings-screen");
  document.body.classList.toggle("agenda-view", hash === "#agenda");
  document.body.classList.toggle("gmail-inbox-view", hash === "#gmail-inbox");
  document.body.classList.toggle("inbox-view", hash === "#inbox" || hash === "#detail");
  document.body.classList.toggle("review-view", hash === "#review-queue");
  const breadcrumb = document.querySelector("#current-screen-title");
  if (breadcrumb) breadcrumb.textContent = title;
  document.title = `${title} · Autónomo OS`;
  document.querySelectorAll<HTMLAnchorElement>(".sidebar nav a").forEach(link => {
    const active = link.hash === hash || (hash === "#detail" && link.hash === "#inbox") || (!screenTitles[hash] && !capsuleDetail && link.hash === "#morning");
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
    // Give icon-only navigation a full name at compact viewport widths.
    const label = link.querySelector("span:not(.capsule-nav-icon)")?.textContent;
    if (label) { link.setAttribute("aria-label", label); link.title = label; }
  });
  if (focus && (screenTitles[hash] || capsuleDetail)) {
    const heading = document.getElementById(capsuleDetail ? 'capsule-view-screen' : hash.slice(1))?.querySelector<HTMLElement>("h1, h2");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    if (hash !== "#detail") window.scrollTo({ top: 0, behavior: "instant" });
  }
}
const menuToggle = document.querySelector<HTMLButtonElement>("#menu-toggle");
function setMenuOpen(open: boolean): void {
  document.body.classList.toggle("menu-open", open);
  menuToggle?.setAttribute("aria-expanded", String(open));
  menuToggle?.setAttribute("aria-label", open ? "Cerrar navegación" : "Abrir navegación");
}
menuToggle?.addEventListener("click", () => setMenuOpen(!document.body.classList.contains("menu-open")));
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.body.classList.contains("menu-open")) {
    setMenuOpen(false); menuToggle?.focus();
  }
});
window.addEventListener("hashchange", () => navigate(true));
navigate();

const navigationDialog = document.querySelector<HTMLDialogElement>("#navigation-search")!;
const navigationInput = document.querySelector<HTMLInputElement>("#navigation-search-input")!;
const navigationResults = document.querySelector<HTMLElement>("#navigation-search-results")!;
const destinations = [
  ["#capsules-screen", "Mi Autónomo OS"],
  ["#runtime-screen", "Centro de agentes"], ["#morning", "Mi jornada"], ["#inbox", "Bandeja unificada"], ["#gmail-inbox", "Correo Gmail"],
  ["#clients-screen", "Clientes y oportunidades"], ["#tasks-screen", "Trabajo pendiente"],
  ["#agenda", "Agenda"], ["#review-queue", "Cola de revisión"],
  ["#installation", "Mi Mac mini"], ["#help-screen", "Ayuda"], ["#automation-screen", "Reglas de preparación"], ["#portfolio-screen", "Cartera de pólizas"], ["#settings-screen", "Configuración"]
];
window.addEventListener('capsules:changed', event => {
  for (const hash of Object.keys(screenTitles)) if (hash.startsWith('#capsule-')) delete screenTitles[hash];
  for (let i=destinations.length-1;i>=0;i--) if (destinations[i]![0]!.startsWith('#capsule-')) destinations.splice(i,1);
  const items = (event as CustomEvent<Array<{hash:string;title:string;enabled:boolean}>>).detail;
  for (const item of items) { screenTitles[item.hash]=item.title; if(item.enabled) destinations.push([item.hash,item.title]); }
  navigate();
});
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

const navPaths: Record<string, string> = {
  "#capsules-screen": "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  "#gmail-inbox": "M3 5h18v14H3z m0 0 9 7 9-7",
  "#morning": "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  "#inbox": "M4 4h16v16H4z M4 14h5l2 3h2l2-3h5",
  "#agenda": "M4 5h16v16H4z M8 3v4 M16 3v4 M4 11h16",
  "#review-queue": "m5 12 4 4L19 6 M4 21h16",
  "#clients-screen": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-4",
  "#portfolio-screen": "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
  "#tasks-screen": "M9 6h11 M9 12h11 M9 18h11 m-16-12 1 1 2-2 m-3 7 1 1 2-2 m-3 7 1 1 2-2",
  "#runtime-screen": "M4 8h16v12H4z M12 4v4 M9 4h6 M8 12h1 M15 12h1 M9 16h6 M1 12h3 M20 12h3",
  "#automation-screen": "m13 2-9 12h7l-1 8 10-12h-7z",
  "#installation": "M3 4h18v13H3z M8 21h8 M12 17v4",
  "#settings-screen": "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  "#help-screen": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01"
};
for (const link of document.querySelectorAll<HTMLAnchorElement>(".sidebar nav a")) {
  const path = navPaths[link.hash]; if (!path) continue;
  for (const child of [...link.childNodes]) if (child.nodeType === Node.TEXT_NODE) child.remove();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  svg.classList.add("nav-icon"); const p = document.createElementNS(svg.namespaceURI, "path");
  p.setAttribute("d", path); svg.append(p); link.prepend(svg);
}

document.querySelector<HTMLAnchorElement>(".skip-link")?.addEventListener("click", event => {
  event.preventDefault(); document.querySelector<HTMLElement>("#main-content")?.focus();
});
