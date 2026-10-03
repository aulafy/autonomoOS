const button = document.querySelector<HTMLButtonElement>("#local-health-check")!;
const result = document.querySelector<HTMLElement>("#local-health-result")!;
button.addEventListener("click", async () => {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  result.textContent = "Comprobando el servicio de la interfaz…";
  try {
    const response = await fetch("/api/local-health", { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) throw new Error("UNAVAILABLE");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") throw new Error("INVALID");
    const health = data as Record<string, unknown>;
    if (health.service !== "pymes-ui" || health.status !== "ok" ||
      typeof health.memoryGiB !== "number" || !Number.isFinite(health.memoryGiB) ||
      typeof health.architecture !== "string") throw new Error("INVALID");
    const time = new Date().toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid" });
    result.textContent = `Interfaz disponible · ${health.architecture} · ${health.memoryGiB} GB de memoria física · comprobado a las ${time}. El rendimiento del asistente no se ha medido con esta comprobación.`;
  } catch {
    result.textContent = "No se pudo verificar el servicio instalado. Si usas la demo de desarrollo, abre la interfaz compilada. En una instalación, revisa el servicio con soporte.";
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
});
