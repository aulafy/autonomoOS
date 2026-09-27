import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

const path = process.env.H4_FIXTURE_DB;
if (!path) throw new Error("H4_FIXTURE_DB_REQUIRED");
const token = process.env.H4_FIXTURE_TOKEN ?? "fixture-token";
const db = new DatabaseSync(path);
db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
db.exec("CREATE TABLE IF NOT EXISTS items (key TEXT PRIMARY KEY, id TEXT NOT NULL, name TEXT NOT NULL, value INTEGER NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS stats (name TEXT PRIMARY KEY, count INTEGER NOT NULL)");
db.exec("INSERT OR IGNORE INTO stats(name,count) VALUES ('post',0),('get',0)");
let mode = "normal";
const bump = (name: string) => db.prepare("UPDATE stats SET count=count+1 WHERE name=?").run(name);
const counts = () => Object.fromEntries((db.prepare("SELECT name,count FROM stats").all() as
  Array<{name:string;count:number}>).map(row => [row.name, row.count]));
const send = (res: any, code: number, value: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
};
const server = createServer(async (req, res) => {
  if (req.url === "/__stats" && req.method === "GET") {
    return send(res, 200, { counts: counts(), items: db.prepare("SELECT * FROM items").all(), mode });
  }
  if (req.url === "/__mode" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const requested = JSON.parse(body).mode;
    if (!["normal", "reject", "drop_after", "delay_after", "malformed",
      "lookup_fail", "uncertified_absence", "redirect", "server_error"].includes(requested)) {
      return send(res, 400, { error: "bad mode" });
    }
    mode = requested;
    return send(res, 200, { mode });
  }
  if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { error: "unauthorized" });
  if (req.url === "/items" && req.method === "POST") {
    bump("post");
    if (mode === "reject") return send(res, 400, { status: "rejected", processed: false });
    let body = "";
    for await (const chunk of req) body += chunk;
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) {
      return send(res, 400, { status: "rejected", processed: false });
    }
    let input: any;
    try { input = JSON.parse(body); }
    catch { return send(res, 400, { status: "rejected", processed: false }); }
    if (typeof input.name !== "string" || !Number.isSafeInteger(input.value)) {
      return send(res, 400, { status: "rejected", processed: false });
    }
    const existing = db.prepare("SELECT * FROM items WHERE key=?").get(key) as any;
    if (!existing) db.prepare("INSERT INTO items(key,id,name,value) VALUES (?,?,?,?)")
      .run(key, `record-${key.slice(0, 12)}`, input.name, input.value);
    const item = (db.prepare("SELECT * FROM items WHERE key=?").get(key) as any);
    if (mode === "drop_after") { req.socket.destroy(); return; }
    if (mode === "delay_after") await new Promise(resolve => setTimeout(resolve, 1000));
    if (mode === "malformed") { res.writeHead(201); res.end("not-json"); return; }
    if (mode === "redirect") {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data" });
      res.end(); return;
    }
    if (mode === "server_error") return send(res, 500, { error: "after-commit" });
    return send(res, 201, { status: "created", recordId: item.id,
      idempotencyKey: key, name: item.name, value: item.value });
  }
  const lookup = req.url?.match(/^\/items\/by-idempotency-key\/([a-f0-9]{64})$/);
  if (lookup && req.method === "GET") {
    bump("get");
    if (mode === "lookup_fail") return send(res, 503, { error: "temporary" });
    const key = lookup[1]!;
    const item = db.prepare("SELECT * FROM items WHERE key=?").get(key) as any;
    if (item) return send(res, 200, { status: "created", recordId: item.id,
      idempotencyKey: key, name: item.name, value: item.value });
    if (mode === "uncertified_absence") return send(res, 404, { status: "not_found" });
    return send(res, 404, { status: "absent", processed: false,
      certified: true, idempotencyKey: key,
      authority: "fixture-key-ledger", reference: `absence:${key}` });
  }
  return send(res, 404, { error: "no route" });
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("ADDRESS_UNAVAILABLE");
  process.stdout.write(`${JSON.stringify({ port: address.port })}\n`);
});
process.on("SIGTERM", () => { server.close(); db.close(); });
