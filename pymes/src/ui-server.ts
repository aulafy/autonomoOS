import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { pathToFileURL } from "node:url";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".woff2": "font/woff2"
};
export function createUiServer(directory: string) {
  const root = resolve(directory);
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
      const target = await realpath(resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`));
      const canonicalRoot = await realpath(root);
      if (!target.startsWith(canonicalRoot + sep) || !contentTypes[extname(target)]) {
        response.writeHead(404); response.end(); return;
      }
      const body = await readFile(target);
      response.writeHead(200, { "Content-Type": contentTypes[extname(target)]!, "Content-Length": body.length });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch { response.writeHead(404); response.end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PYMES_UI_PORT ?? 5175);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("INVALID_UI_PORT");
  const directory = resolve(import.meta.dirname, "../dist");
  await readFile(resolve(directory, "index.html")); // Fail at startup when the build is missing.
  const server = createUiServer(directory);
  server.listen(port, "127.0.0.1", () => console.log(`PYMES UI: http://127.0.0.1:${port}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.close());
}
