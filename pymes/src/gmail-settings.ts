import type { WorkspaceClient } from "./workspace-client.js";
import type { GmailConnectionView } from "./gmail-oauth.js";
let client: WorkspaceClient | null = null,
  epoch = 0,
  busy = false,
  timer: ReturnType<typeof setTimeout> | null = null;
const states = {
  not_connected: "Sin conectar",
  connecting: "Esperando autorización de Google",
  connected: "Conectado",
  authorization_error: "Autorización pendiente o con error",
};
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function render(view: GmailConnectionView) {
  const root = document.getElementById("gmail-connection");
  if (!root) return;
  root.innerHTML = `<div><h3>Email · Gmail</h3><p>${escape(states[view.state])}</p><p>Cuenta: ${escape(view.account ?? "—")}</p><p>Última comprobación: ${view.lastCheckedAt ? escape(new Date(view.lastCheckedAt).toLocaleString("es-ES")) : "—"}</p><details><summary>Permisos concedidos</summary><ul>${view.scopes.map((s) => `<li>${escape(s)}</li>`).join("")}</ul></details></div><div>${view.state === "connected" ? '<button data-gmail="check">Comprobar cuenta</button><button data-gmail="disconnect">Desconectar</button>' : view.state === "connecting" ? '<p>Continúa en el navegador del sistema.</p><button data-gmail="disconnect">Cancelar conexión</button>' : `<label><input id="gmail-verification" type="checkbox"> Autorizar gmail.readonly: permite leer toda la cuenta. M3 solo consulta Enviados para comprobar y reconciliar sin reenviar.</label><p>Sin lectura, los envíos quedan sin comprobación independiente. Se pide gmail.send y openid/email para identificar la cuenta.</p><button data-gmail="connect" ${view.configured ? "" : "disabled"}>Conectar Gmail</button>${view.configured ? "" : "<p>El instalador debe importar el cliente OAuth Desktop al llavero de este Mac.</p>"}`}<button data-gmail="refresh">Actualizar estado</button><p id="gmail-feedback" role="status"></p></div>`;
  root.querySelectorAll<HTMLButtonElement>("[data-gmail]").forEach(
    (button) =>
      (button.onclick = () => {
        const op = button.dataset.gmail as
          | "connect"
          | "check"
          | "disconnect"
          | "refresh";
        const verification =
          root.querySelector<HTMLInputElement>("#gmail-verification")
            ?.checked ?? false;
        void update(op === "refresh" ? undefined : op, verification);
      }),
  );
}
async function update(
  operation?: "connect" | "check" | "disconnect",
  verification = false,
) {
  const current = client,
    generation = epoch;
  if (!current || busy) return;
  busy = true;
  const root = document.getElementById("gmail-connection");
  root
    ?.querySelectorAll<HTMLButtonElement>("button")
    .forEach((b) => (b.disabled = true));
  try {
    const view = await current.gmail(operation, verification);
    if (current !== client || generation !== epoch) return;
    render(view);
    if (view.state === "connecting") {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void update(), 3000);
    }
  } catch {
    if (current !== client || generation !== epoch) return;
    const target = document.getElementById("gmail-feedback");
    if (target)
      target.textContent =
        "No se ha confirmado la operación. Consulta el estado antes de continuar.";
    else if (root)
      root.textContent =
        "Gmail no está disponible en esta instalación. Activa el conector local y conecta tu espacio.";
    root
      ?.querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = false));
  } finally {
    if (generation === epoch) busy = false;
  }
}
export function setGmailSettingsClient(value: WorkspaceClient | null) {
  epoch++;
  busy = false;
  if (timer) clearTimeout(timer);
  timer = null;
  client = value;
  const root = document.getElementById("gmail-connection");
  if (root)
    root.textContent =
      "Email · Gmail: conecta tu espacio para consultar la cuenta.";
  if (value) void update();
}
