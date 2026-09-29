import { createServer } from "node:http";
import { WorkspaceApi } from "./workspace-api.js";
import { handlePymesRequest } from "./api-server.js";

const port = Number(process.env.PYMES_API_PORT ?? 8790);
const host = process.env.PYMES_API_HOST ?? "127.0.0.1";
const token = process.env.PYMES_API_BOOTSTRAP_TOKEN;
const tenantId = process.env.PYMES_API_BOOTSTRAP_TENANT ?? "demo-agency";
const userId = process.env.PYMES_API_BOOTSTRAP_USER ?? "demo-owner";

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("INVALID_PYMES_API_PORT");
if (!token || token.length < 16) {
  throw new Error("PYMES_API_BOOTSTRAP_TOKEN_REQUIRED");
}

const api = new WorkspaceApi();
api.addSession(token, { userId, tenantId, role: "owner" });
const server = createServer(async (request, nodeResponse) => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  request.on("data", chunk => {
    bytes += chunk.length;
    if (bytes <= 1_048_576) chunks.push(chunk);
    else request.destroy();
  });
  request.on("end", async () => {
    if (bytes > 1_048_576) return;
    const url = `http://${request.headers.host ?? `${host}:${port}`}${request.url ?? "/"}`;
    const body = Buffer.concat(chunks);
    const webRequest = new Request(url, { method: request.method ?? "GET",
      headers: Object.entries(request.headers).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value.join(",") : value] as [string, string]]),
      body: request.method === "POST" ? body : undefined });
    const webResponse = await handlePymesRequest(api, webRequest);
    nodeResponse.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => nodeResponse.setHeader(key, value));
    nodeResponse.end(Buffer.from(await webResponse.arrayBuffer()));
  });
});
server.listen(port, host, () => console.log(`PYMES API listening on http://${host}:${port}`));
