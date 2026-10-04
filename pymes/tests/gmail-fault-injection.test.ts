import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createP01ResponseLoss,
  loadP01Arm,
  readP01State,
  p01StatePath,
  GMAIL_SEND_URL,
  P01_DISCARDED,
  type P01Arm,
} from "../src/gmail-fault-injection.js";
import { findEmailStatus } from "../src/p01-pilot-kill.js";

const KEY = "a".repeat(64);
const arm: P01Arm = {
  version: 1,
  tenant: "agency",
  owner: "owner",
  subject: "M3-C-20261004-1200",
  to: "recipient@example.org",
};
function mime(subject: string, to: string, key = KEY) {
  const enc = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const m = [
    "From: owner@example.org",
    "To: " + to,
    "Subject: " + enc,
    `Message-ID: <awos.${key}@autonomo-os.invalid>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("cuerpo").toString("base64"),
    "",
  ].join("\r\n");
  return JSON.stringify({ raw: Buffer.from(m).toString("base64url") });
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "p01-")),
    armPath = join(dir, "arm.json");
  writeFileSync(armPath, JSON.stringify(arm));
  return {
    dir,
    armPath,
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}
function upstream(status = 200, body: unknown = { id: "gmail123" }) {
  const calls: { url: string; method: string }[] = [];
  const f: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return new Response(JSON.stringify(body), { status });
  };
  return { f, calls };
}
const post = (body: string, signal?: AbortSignal) => ({
  method: "POST",
  headers: {
    Authorization: "Bearer synthetic",
    "Content-Type": "application/json",
  },
  body,
  signal,
});

test("P01: matching accepted send is forwarded once, response withheld, state durable, single use", async () => {
  const s = setup();
  try {
    const u = upstream(),
      logs: unknown[] = [];
    const h = createP01ResponseLoss(u.f, s.armPath, arm, (e, m) =>
      logs.push([e, m]),
    );
    assert.equal(h.armed(), true);
    await assert.rejects(
      h.fetcher(GMAIL_SEND_URL, post(mime(arm.subject, arm.to))),
      new RegExp(P01_DISCARDED),
    );
    assert.equal(u.calls.length, 1);
    const st = readP01State(s.armPath)!;
    assert.equal(st.phase, "response_discarded");
    assert.equal(st.httpStatus, 200);
    assert.equal(st.gmailId, "gmail123");
    assert.equal(st.messageId, `<awos.${KEY}@autonomo-os.invalid>`);
    assert.equal(st.pid, process.pid);
    assert.equal(h.armed(), false);
    // Second identical send passes through untouched.
    const r = await h.fetcher(
      GMAIL_SEND_URL,
      post(mime(arm.subject, arm.to, "b".repeat(64))),
    );
    assert.equal(r.status, 200);
    assert.equal(u.calls.length, 2);
    // No secrets or body in the durable state or the logs.
    const dump = JSON.stringify(st) + JSON.stringify(logs);
    assert.doesNotMatch(dump, /Bearer|synthetic|cuerpo|raw|recipient@/);
  } finally {
    s.done();
  }
});

test("P01: only the exact send endpoint, POST, Subject and To are selected", async () => {
  const s = setup();
  try {
    const u = upstream(),
      h = createP01ResponseLoss(u.f, s.armPath, arm);
    for (const [url, init] of [
      ["https://oauth2.googleapis.com/token", post("grant_type=refresh_token")],
      [
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=x",
        { method: "GET" },
      ],
      [GMAIL_SEND_URL + "?alt=json", post(mime(arm.subject, arm.to))],
      [GMAIL_SEND_URL, post(mime("M3-C-otro-asunto", arm.to))],
      [GMAIL_SEND_URL, post(mime(arm.subject, "otro@example.org"))],
      [GMAIL_SEND_URL, post("{}")],
    ] as const) {
      const r = await h.fetcher(url, init as RequestInit);
      assert.equal(r.status, 200);
    }
    assert.equal(u.calls.length, 6);
    assert.equal(existsSync(p01StatePath(s.armPath)), false);
    assert.equal(h.armed(), true);
  } finally {
    s.done();
  }
});

test("P01: without confirmed acceptance nothing is invented; equivalent response, shot spent", async () => {
  const s = setup();
  try {
    const u = upstream(500, { error: { code: 500 } }),
      h = createP01ResponseLoss(u.f, s.armPath, arm);
    const r = await h.fetcher(GMAIL_SEND_URL, post(mime(arm.subject, arm.to)));
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: { code: 500 } });
    const st = readP01State(s.armPath)!;
    assert.equal(st.phase, "not_activated");
    assert.equal(st.reason, "NO_CONFIRMED_ACCEPTANCE");
    assert.equal(st.httpStatus, 500);
    assert.equal(u.calls.length, 1);
    assert.equal(h.armed(), false);
  } finally {
    s.done();
  }
});

test("P01: 200 without a valid id is not treated as acceptance", async () => {
  const s = setup();
  try {
    const h = createP01ResponseLoss(upstream(200, {}).f, s.armPath, arm);
    assert.equal(
      (await h.fetcher(GMAIL_SEND_URL, post(mime(arm.subject, arm.to)))).status,
      200,
    );
    assert.equal(readP01State(s.armPath)!.phase, "not_activated");
  } finally {
    s.done();
  }
});

test("P01: transport error is recorded and rethrown, never converted to acceptance", async () => {
  const s = setup();
  try {
    const h = createP01ResponseLoss(
      async () => {
        throw new Error("NET");
      },
      s.armPath,
      arm,
    );
    await assert.rejects(
      h.fetcher(GMAIL_SEND_URL, post(mime(arm.subject, arm.to))),
      /NET/,
    );
    const st = readP01State(s.armPath)!;
    assert.equal(st.phase, "not_activated");
    assert.equal(st.reason, "TRANSPORT_ERROR");
  } finally {
    s.done();
  }
});

test("P01: an already-aborted request does not consume the shot", async () => {
  const s = setup();
  try {
    const c = new AbortController();
    c.abort();
    const u = upstream(),
      h = createP01ResponseLoss(
        async (i, init) => {
          init?.signal?.throwIfAborted();
          return u.f(i, init);
        },
        s.armPath,
        arm,
      );
    await assert.rejects(
      h.fetcher(GMAIL_SEND_URL, post(mime(arm.subject, arm.to), c.signal)),
    );
    assert.equal(h.armed(), true);
    assert.equal(existsSync(p01StatePath(s.armPath)), false);
  } finally {
    s.done();
  }
});

test("P01: consumption survives restart; a new instance with the same arm stays inert", async () => {
  const s = setup();
  try {
    const first = createP01ResponseLoss(upstream().f, s.armPath, arm);
    await assert.rejects(
      first.fetcher(GMAIL_SEND_URL, post(mime(arm.subject, arm.to))),
    );
    const u = upstream(),
      again = createP01ResponseLoss(u.f, s.armPath, arm);
    assert.equal(again.armed(), false);
    const r = await again.fetcher(
      GMAIL_SEND_URL,
      post(mime(arm.subject, arm.to)),
    );
    assert.equal(r.status, 200);
    assert.equal(u.calls.length, 1);
    assert.equal(readP01State(s.armPath)!.phase, "response_discarded");
  } finally {
    s.done();
  }
});

test("P01: two concurrent instances cannot both fire (O_EXCL claim)", async () => {
  const s = setup();
  try {
    const u = upstream(),
      a = createP01ResponseLoss(u.f, s.armPath, arm),
      b = createP01ResponseLoss(u.f, s.armPath, arm);
    const results = await Promise.allSettled([
      a.fetcher(GMAIL_SEND_URL, post(mime(arm.subject, arm.to))),
      b.fetcher(GMAIL_SEND_URL, post(mime(arm.subject, arm.to))),
    ]);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(u.calls.length, 2);
  } finally {
    s.done();
  }
});

test("P01: arm file is validated and bound to tenant/owner", () => {
  const s = setup();
  try {
    assert.deepEqual(
      loadP01Arm(s.armPath, { tenant: "agency", owner: "owner" }),
      arm,
    );
    assert.throws(
      () => loadP01Arm(s.armPath, { tenant: "x", owner: "owner" }),
      /P01_ARM_SCOPE_MISMATCH/,
    );
    const bad = (v: unknown) => {
      writeFileSync(s.armPath, JSON.stringify(v));
      return () => loadP01Arm(s.armPath, { tenant: "agency", owner: "owner" });
    };
    assert.throws(bad({ ...arm, subject: "Correo normal" }), /SUBJECT/);
    assert.throws(bad({ ...arm, to: "client@example.test" }), /RECIPIENT/);
    assert.throws(bad({ ...arm, extra: 1 }), /P01_ARM_INVALID/);
    assert.throws(bad({ ...arm, version: 2 }), /P01_ARM_INVALID/);
    writeFileSync(s.armPath, "no-json");
    assert.throws(
      () => loadP01Arm(s.armPath, { tenant: "agency", owner: "owner" }),
      /P01_ARM_INVALID/,
    );
  } finally {
    s.done();
  }
});

test("P01 kill helper: recognises only an email projection with effects", () => {
  assert.equal(findEmailStatus({ status: "unknown", effects: [] }), "unknown");
  assert.equal(
    findEmailStatus({ email: { status: "unknown", effects: [] } }),
    null,
  );
  assert.equal(findEmailStatus({ status: "unknown" }), null);
  assert.equal(findEmailStatus(null), null);
});

test("P01: claim persistence failure blocks the selected POST instead of bypassing injection", async () => {
  const s = setup();
  try {
    const u = upstream(),
      h = createP01ResponseLoss(u.f, join(s.dir, "missing", "arm.json"), arm);
    await assert.rejects(
      h.fetcher(GMAIL_SEND_URL, post(mime(arm.subject, arm.to))),
      /P01_CLAIM_PERSISTENCE_FAILED/,
    );
    assert.equal(u.calls.length, 0);
  } finally {
    s.done();
  }
});
test("P01: corrupt state and unsafe PID are rejected with sanitized diagnostics", () => {
  const s = setup();
  try {
    writeFileSync(
      p01StatePath(s.armPath),
      '{"pid":-1,"secret":"synthetic-do-not-echo"}',
    );
    assert.throws(() => readP01State(s.armPath), /^Error: P01_STATE_INVALID$/);
    writeFileSync(p01StatePath(s.armPath), "synthetic-invalid-json");
    assert.throws(() => readP01State(s.armPath), /^Error: P01_STATE_INVALID$/);
  } finally {
    s.done();
  }
});
test("P01: oversized response is bounded, unconfirmed, never retried", async () => {
  const s = setup();
  try {
    const u = upstream(200, { id: "gmail123", data: "x".repeat(200001) }),
      h = createP01ResponseLoss(u.f, s.armPath, arm);
    await assert.rejects(
      h.fetcher(GMAIL_SEND_URL, post(mime(arm.subject, arm.to))),
      /P01_RESPONSE_TOO_LARGE/,
    );
    assert.equal(h.state()!.phase, "not_activated");
    assert.equal(u.calls.length, 1);
  } finally {
    s.done();
  }
});
