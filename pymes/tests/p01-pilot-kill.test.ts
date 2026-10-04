import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gmailRuntime } from "./fixtures/gmail-runtime.js";
import { P01_TEST_ARM, approveP01Email } from "./fixtures/gmail-fault.js";
import {
  createP01ResponseLoss,
  p01StatePath,
  readP01State,
} from "../src/gmail-fault-injection.js";
import {
  confirmsP01Unknown,
  killP01Pilot,
  type P01KillDependencies,
} from "../src/p01-pilot-kill.js";
import {
  WorkspaceApi,
  InMemoryWorkspaceRepository,
} from "../src/workspace-api.js";
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "p01-helper-")),
    armPath = join(dir, "arm.json"),
    arm = { ...P01_TEST_ARM, to: "recipient@example.org" };
  writeFileSync(armPath, JSON.stringify(arm), { mode: 0o600 });
  const harness = createP01ResponseLoss(
    async () => new Response(JSON.stringify({ id: "sentC" })),
    armPath,
    arm,
  );
  const f = await gmailRuntime(join(dir, "runtime.db"), harness.fetcher);
  await approveP01Email(f, arm);
  await f.runtime.source.email!.execute("job", "owner");
  const state = {
    ...readP01State(armPath)!,
    pid: 123456,
    processStart: "synthetic-start",
  };
  writeFileSync(p01StatePath(armPath), JSON.stringify(state));
  const repo = new InMemoryWorkspaceRepository(),
    api = new WorkspaceApi(repo, undefined, f.runtime.source);
  api.addSession("synthetic-owner-token-123456", {
    userId: "owner",
    tenantId: "agency",
    role: "owner",
  });
  const calls: number[] = [];
  const deps: P01KillDependencies = {
    process: () => ({
      start: state.processStart,
      command: "node /local/pymes/src/server.ts",
      listening: true,
    }),
    fetcher: async () => {
      const r = await api.handleAsync({
        method: "GET",
        path: "/v1/workspaces/agency/runtime/job/email",
        authorization: "Bearer synthetic-owner-token-123456",
      });
      return new Response(JSON.stringify(r.body), { status: r.status });
    },
    kill: (pid) => calls.push(pid),
    wait: async () => {},
  };
  const options = {
    armPath,
    taskId: "job",
    tenant: "agency",
    token: "synthetic-owner-token-123456",
    port: 8790,
  };
  return {
    ...f,
    dir,
    arm,
    armPath,
    state,
    deps,
    options,
    calls,
    view: () => ({
      tenantId: "agency",
      ...f.runtime.source.email!.view("job", "owner"),
    }),
    cleanup: () => {
      f.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("P01 kill correlates actual API root, approval payload and C6 Message-ID before signaling only the verified pilot", async () => {
  const f = await setup();
  try {
    assert.equal(confirmsP01Unknown(f.view(), f.arm, f.state, "job"), true);
    await killP01Pilot(f.options, f.deps);
    assert.deepEqual(f.calls, [f.state.pid]);
  } finally {
    f.cleanup();
  }
});
for (const mode of [
  "reused-pid",
  "wrong-listener",
  "wrong-command",
  "wrong-message",
  "other-task",
  "not-unknown",
  "auth-failure",
  "unsafe-pid",
] as const)
  test("P01 kill refuses " + mode + " without any signal", async () => {
    const f = await setup();
    try {
      if (mode === "reused-pid")
        f.deps.process = () => ({
          start: "new-start",
          command: "node /local/pymes/src/server.ts",
          listening: true,
        });
      if (mode === "wrong-listener")
        f.deps.process = () => ({
          start: f.state.processStart,
          command: "node /local/pymes/src/server.ts",
          listening: false,
        });
      if (mode === "wrong-command")
        f.deps.process = () => ({
          start: f.state.processStart,
          command: "node unrelated.ts",
          listening: true,
        });
      if (mode === "wrong-message")
        writeFileSync(
          p01StatePath(f.armPath),
          JSON.stringify({
            ...f.state,
            messageId: `<awos.${"f".repeat(64)}@autonomo-os.invalid>`,
          }),
        );
      if (mode === "other-task") f.options.taskId = "other";
      if (mode === "not-unknown")
        f.deps.fetcher = async () =>
          new Response(JSON.stringify({ ...f.view(), status: "completed" }));
      if (mode === "auth-failure")
        f.deps.fetcher = async () => new Response("{}", { status: 401 });
      if (mode === "unsafe-pid")
        writeFileSync(
          p01StatePath(f.armPath),
          JSON.stringify({ ...f.state, pid: -1 }),
        );
      await assert.rejects(killP01Pilot(f.options, f.deps));
      assert.equal(f.calls.length, 0);
    } finally {
      f.cleanup();
    }
  });
