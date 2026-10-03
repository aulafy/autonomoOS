import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gmailRuntime, approveEmail } from "./fixtures/gmail-runtime.js";
import {
  WorkspaceApi,
  InMemoryWorkspaceRepository,
} from "../src/workspace-api.js";
const json = (v: unknown) => new Response(JSON.stringify(v));
test("Gmail adapter executes through C11 exact approval, projects independent proof; disconnect keeps history", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gmail-product-"));
  let raw = "",
    calls = 0;
  const f = await gmailRuntime(join(dir, "runtime.db"), async (_input, init) =>
    init?.method === "POST"
      ? (calls++,
        (raw = JSON.parse(String(init.body)).raw),
        json({ id: "sent1" }))
      : json({ id: "sent1", labelIds: ["SENT"], raw }),
  );
  try {
    await approveEmail(f);
    const view = await f.runtime.source.email!.execute("job", "owner");
    assert.equal(view.status, "completed");
    assert.equal(view.simulated, false);
    assert.ok(view.effects[0]?.observationIds.length);
    assert.equal(f.runtime.kernel.snapshot().tasks.job!.status, "completed");
    assert.equal(
      (await f.runtime.source.email!.execute("job", "owner")).status,
      "completed",
    );
    assert.equal(calls, 1);
    const repo = new InMemoryWorkspaceRepository(),
      api = new WorkspaceApi(repo, undefined, f.runtime.source);
    api.addSession("other-owner-token-123456", {
      userId: "other",
      tenantId: "agency",
      role: "owner",
    });
    assert.equal(
      (
        await api.handleAsync({
          method: "GET",
          path: "/v1/workspaces/agency/gmail",
          authorization: "Bearer other-owner-token-123456",
        })
      ).status,
      409,
    );
    await f.gmail.disconnect("owner");
    assert.equal(
      f.runtime.source.email!.view("job", "owner").status,
      "completed",
    );
    assert.equal(calls, 1);
  } finally {
    f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test(
  "SIGKILL after Gmail accepts: C12 UNKNOWN -> read-only reconcile, exactly one POST across restart",
  { timeout: 20000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "gmail-kill-")),
      path = join(dir, "runtime.db");
    let raw = "",
      calls = 0,
      accepted!: () => void;
    const acceptance = new Promise<void>((resolve) => (accepted = resolve));
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (req.method === "POST") {
          calls++;
          raw = JSON.parse(body).raw;
          accepted();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            req.url!.includes("format=raw")
              ? { id: "sent1", labelIds: ["SENT"], raw }
              : { messages: [{ id: "sent1" }] },
          ),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as { port: number },
      endpoint = `http://127.0.0.1:${address.port}`;
    const child = fork(
      new URL("./fixtures/gmail-crash.ts", import.meta.url),
      [path, endpoint],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let errors = "";
    child.stderr?.on("data", (c) => (errors += c));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        acceptance,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("WAIT_FOR_ACCEPTANCE " + errors)),
            10000,
          );
          child.once("exit", (code) =>
            reject(new Error("EARLY_EXIT " + code + " " + errors)),
          );
        }),
      ]);
      if (timer) clearTimeout(timer);
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      const fetcher: typeof fetch = (input, init) =>
        fetch(
          endpoint +
            new URL(String(input)).pathname +
            new URL(String(input)).search,
          init,
        );
      const f = await gmailRuntime(path, fetcher);
      try {
        assert.equal(
          f.runtime.source.email!.view("job", "owner").status,
          "unknown",
        );
        const result = await f.runtime.source.email!.reconcile("job", "owner");
        assert.equal(result.status, "completed");
        assert.equal(result.effects[0]?.status, "unknown");
        assert.equal(result.effects[0]?.effective, "committed");
        await f.runtime.source.email!.reconcile("job", "owner");
        assert.equal(calls, 1);
      } finally {
        f.close();
      }
    } finally {
      if (timer) clearTimeout(timer);
      child.kill("SIGKILL");
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
