import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gmailRuntime } from "./fixtures/gmail-runtime.js";
import { P01_TEST_ARM, approveP01Email } from "./fixtures/gmail-fault.js";
import {
  createP01ResponseLoss,
  readP01State,
} from "../src/gmail-fault-injection.js";

function syntheticGmail() {
  let raw = "",
    posts = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST") {
        posts++;
        raw = JSON.parse(body).raw;
        return res.end(JSON.stringify({ id: "sentC" }));
      }
      res.end(
        JSON.stringify(
          req.url!.includes("format=raw")
            ? { id: "sentC", labelIds: ["SENT"], raw }
            : { messages: [{ id: "sentC" }] },
        ),
      );
    });
  });
  return { server, posts: () => posts };
}

test("P01 in-process: accepted response discarded -> UNKNOWN through C11; reconcile without POST", async () => {
  const dir = mkdtempSync(join(tmpdir(), "p01-run-")),
    armPath = join(dir, "arm.json");
  let raw = "",
    posts = 0;
  const base: typeof fetch = async (_i, init) =>
    init?.method === "POST"
      ? (posts++,
        (raw = JSON.parse(String(init.body)).raw),
        new Response(JSON.stringify({ id: "sentC" })))
      : new Response(
          JSON.stringify(
            String(_i).includes("format=raw")
              ? { id: "sentC", labelIds: ["SENT"], raw }
              : { messages: [{ id: "sentC" }] },
          ),
        );
  const h = createP01ResponseLoss(base, armPath, P01_TEST_ARM);
  const f = await gmailRuntime(join(dir, "runtime.db"), h.fetcher);
  try {
    await approveP01Email(f);
    // C11 may surface the uncertain dispatch as an error or as a view; both are fine.
    await f.runtime.source.email!.execute("job", "owner").catch(() => null);
    assert.equal(
      f.runtime.source.email!.view("job", "owner").status,
      "unknown",
    );
    assert.equal(readP01State(armPath)!.phase, "response_discarded");
    assert.equal(posts, 1);
    // Re-executing an UNKNOWN effect must not POST again.
    await f.runtime.source.email!.execute("job", "owner").catch(() => null);
    assert.equal(posts, 1);
    const r = await f.runtime.source.email!.reconcile("job", "owner");
    assert.equal(r.status, "completed");
    assert.equal(r.effects[0]?.status, "unknown");
    assert.equal(r.effects[0]?.effective, "committed");
    assert.equal(posts, 1);
  } finally {
    f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "P01 SIGKILL: Gmail accepts, response discarded, UNKNOWN durable, kill, restart (still armed config), reconcile, one POST",
  { timeout: 30000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "p01-kill-")),
      path = join(dir, "runtime.db"),
      armPath = join(dir, "arm.json");
    const g = syntheticGmail();
    await new Promise<void>((r) => g.server.listen(0, "127.0.0.1", r));
    const endpoint = `http://127.0.0.1:${(g.server.address() as { port: number }).port}`;
    const child = fork(
      new URL("./fixtures/gmail-fault-crash.ts", import.meta.url),
      [path, endpoint, armPath],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let errors = "";
    child.stderr?.on("data", (c) => (errors += c));
    try {
      const [message] = (await Promise.race([
        once(child, "message"),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error("WAIT_UNKNOWN " + errors)),
            20000,
          ).unref();
          child.once("exit", (c) =>
            reject(new Error("EARLY_EXIT " + c + " " + errors)),
          );
        }),
      ])) as [{ status: string; phase: string }];
      assert.equal(message.status, "unknown");
      assert.equal(message.phase, "response_discarded");
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      assert.equal(g.posts(), 1);
      const base: typeof fetch = (i, init) =>
        fetch(
          endpoint + new URL(String(i)).pathname + new URL(String(i)).search,
          init,
        );
      // Restart with the same arm configured: the harness must stay inert.
      const h = createP01ResponseLoss(base, armPath, P01_TEST_ARM);
      assert.equal(h.armed(), false);
      const f = await gmailRuntime(path, h.fetcher);
      try {
        assert.equal(
          f.runtime.source.email!.view("job", "owner").status,
          "unknown",
        );
        const r = await f.runtime.source.email!.reconcile("job", "owner");
        assert.equal(r.status, "completed");
        assert.equal(r.effects[0]?.status, "unknown");
        assert.equal(r.effects[0]?.effective, "committed");
        await f.runtime.source.email!.reconcile("job", "owner");
        assert.equal(g.posts(), 1);
      } finally {
        f.close();
      }
    } finally {
      child.kill("SIGKILL");
      g.server.closeAllConnections();
      await new Promise<void>((r) => g.server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
