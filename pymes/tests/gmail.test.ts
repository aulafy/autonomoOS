import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GmailOAuth,
  GMAIL_SEND_SCOPE,
  GMAIL_READ_SCOPE,
  type GmailCredential,
} from "../src/gmail-oauth.js";
import { GmailEmailProvider } from "../src/gmail-email-provider.js";
import { gmailMime, verifyGmailRaw, gmailPayload } from "../src/gmail-mime.js";
import { EmailDispatchError } from "../src/email-provider.js";
import type { CredentialVault } from "../src/gmail-keychain.js";
class Vault implements CredentialVault {
  values = new Map<string, string>();
  async get(k: string) {
    return this.values.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.values.set(k, v);
  }
  async delete(k: string) {
    this.values.delete(k);
  }
}
const payload = {
    from: "owner@example.test",
    to: ["client@example.test"],
    cc: [],
    bcc: [],
    subject: "Renovación 🚗 · José — seguros y autónomos".repeat(3),
    body: "Buenos días, José.\nLínea 2\r\nUn saludo 🚗",
    contactId: "test-contact",
  },
  key = "a".repeat(64),
  signal = () => new AbortController().signal;
const credential = (read = true): GmailCredential => ({
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  expiresAt: Date.now() + 3600000,
  clientId: "test.apps.googleusercontent.com",
  clientSecret: "synthetic-client",
  account: payload.from,
  subject: "account-one",
  scopes: [
    GMAIL_SEND_SCOPE,
    "openid",
    "email",
    ...(read ? [GMAIL_READ_SCOPE] : []),
  ],
  generation: "b".repeat(64),
});
async function setup(fetcher: typeof fetch, read = true, path = ":memory:") {
  const vault = new Vault(),
    oauth = new GmailOAuth(
      vault,
      { tenant: "agency", owner: "owner" },
      async () => {},
      fetcher,
    );
  await vault.set(oauth.credentialRef, JSON.stringify(credential(read)));
  const provider = new GmailEmailProvider(oauth, path, fetcher, 50);
  await provider.status();
  return {
    vault,
    oauth,
    provider,
    close: () => {
      provider.close();
      oauth.close();
    },
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("MIME preserves approved UTF-8, line endings; permits repeated transport headers and rejects changed proof", () => {
  const mime = gmailMime(payload, key),
    raw = (s: string) => Buffer.from(s).toString("base64url");
  assert.equal(verifyGmailRaw(raw(mime), payload, key), true);
  assert.equal(
    verifyGmailRaw(
      raw("Received: one\r\nReceived: two\r\n" + mime),
      payload,
      key,
    ),
    true,
  );
  assert.equal(
    verifyGmailRaw(raw("To: attacker@example.test\r\n" + mime), payload, key),
    false,
  );
  assert.equal(
    verifyGmailRaw(raw(mime), { ...payload, body: payload.body + "!" }, key),
    false,
  );
  assert.throws(() =>
    gmailPayload({ ...payload, cc: ["other@example.test"] }, payload.from),
  );
  assert.throws(() => gmailPayload(payload, "other@example.test"));
});
for (const status of [401, 403, 429, 500, 503])
  test(`HTTP ${status} remains UNKNOWN and never repeats POST`, async () => {
    let sends = 0;
    const f = await setup(async () => {
      sends++;
      return json({}, status);
    });
    try {
      await assert.rejects(
        f.provider.send(payload, key, signal()),
        (e: unknown) =>
          e instanceof EmailDispatchError && e.certainty === "unknown",
      );
      await assert.rejects(f.provider.send(payload, key, signal()));
      assert.equal(sends, 1);
      assert.equal(await f.provider.reconcile(key, signal()), null);
    } finally {
      f.close();
    }
  });
test("lost response: restart reconciles stable Message-ID and exact raw content without another send", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gmail-restart-"));
  let sends = 0,
    query = "";
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      sends++;
      assert.equal(
        JSON.parse(String(init.body)).raw,
        Buffer.from(gmailMime(payload, key)).toString("base64url"),
      );
      throw new Error("synthetic network lost");
    }
    if (url.includes("?format=raw"))
      return json({
        id: "sent1",
        labelIds: ["SENT"],
        raw: Buffer.from(gmailMime(payload, key)).toString("base64url"),
      });
    query = url;
    return json({ messages: [{ id: "sent1" }] });
  };
  let f = await setup(fetcher, true, join(dir, "claims.db"));
  try {
    await assert.rejects(f.provider.send(payload, key, signal()));
    f.close();
    f = await setup(fetcher, true, join(dir, "claims.db"));
    const receipt = await f.provider.reconcile(key, signal());
    assert.equal(receipt?.id, "gmail:sent1");
    assert.ok(
      new URL(query).searchParams.get("q")?.includes("rfc822msgid:<awos."),
    );
    await assert.rejects(f.provider.send(payload, key, signal()));
    assert.equal(sends, 1);
  } finally {
    f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
for (const messages of [[], [{ id: "one" }, { id: "two" }]])
  test("absent or ambiguous evidence stays UNKNOWN", async () => {
    let sends = 0;
    const f = await setup(async (_input, init) =>
      init?.method === "POST"
        ? (sends++, json({ id: "sent1" }))
        : json({ messages }),
    );
    try {
      await f.provider.send(payload, key, signal());
      assert.equal(await f.provider.reconcile(key, signal()), null);
      assert.equal(sends, 1);
    } finally {
      f.close();
    }
  });
test("send-only grants never attempt Gmail reads or claim observed success", async () => {
  let calls = 0;
  const f = await setup(async () => {
    calls++;
    return json({ id: "sent1" });
  }, false);
  try {
    await f.provider.send(payload, key, signal());
    assert.equal(await f.provider.observe(key, signal()), null);
    assert.equal(calls, 1);
  } finally {
    f.close();
  }
});
test("pre-dispatch abort and disconnect are certified not started", async () => {
  let calls = 0;
  const f = await setup(async () => {
    calls++;
    return json({});
  });
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      f.provider.send(payload, key, controller.signal),
      (e: unknown) =>
        e instanceof EmailDispatchError && e.certainty === "not_started",
    );
    await f.oauth.disconnect();
    await assert.rejects(f.provider.send(payload, key, signal()));
    assert.equal(calls, 0);
  } finally {
    f.close();
  }
});
test("expired token refreshes once; revoked credential cannot dispatch", async () => {
  let calls = 0;
  const f = await setup(async (input) => {
    assert.equal(String(input), "https://oauth2.googleapis.com/token");
    calls++;
    return json({ access_token: "synthetic-new", expires_in: 3600 });
  });
  try {
    await f.vault.set(
      f.oauth.credentialRef,
      JSON.stringify({ ...credential(), expiresAt: 0 }),
    );
    const [a, b] = await Promise.all([
      f.oauth.credential(),
      f.oauth.credential(),
    ]);
    assert.equal(a.accessToken, "synthetic-new");
    assert.equal(b.accessToken, a.accessToken);
    assert.equal(calls, 1);
  } finally {
    f.close();
  }
  const revoked = await setup(async () =>
    json({ error: "invalid_grant" }, 400),
  );
  try {
    await revoked.vault.set(
      revoked.oauth.credentialRef,
      JSON.stringify({ ...credential(), expiresAt: 0 }),
    );
    assert.equal(
      (await revoked.provider.status()).state,
      "authorization_error",
    );
    await assert.rejects(revoked.provider.send(payload, key, signal()));
  } finally {
    revoked.close();
  }
});
test("OAuth system-browser loopback binds state, PKCE; cancellation persists no tokens", async () => {
  const vault = new Vault();
  let authUrl = "";
  const oauth = new GmailOAuth(
    vault,
    { tenant: "agency", owner: "owner" },
    async (url) => {
      authUrl = url;
    },
    async () => {
      throw new Error("must not exchange on cancel");
    },
  );
  try {
    await oauth.configure({
      clientId: "test.apps.googleusercontent.com",
      clientSecret: "synthetic-client",
    });
    assert.equal((await oauth.connect(false)).state, "connecting");
    const auth = new URL(authUrl);
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    assert.equal(
      auth.searchParams.get("scope")?.includes(GMAIL_READ_SCOPE),
      false,
    );
    const callback = new URL(auth.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      state: auth.searchParams.get("state")!,
      error: "access_denied",
    }).toString();
    await fetch(callback);
    assert.equal((await oauth.status()).error, "GMAIL_OAUTH_CANCELLED");
    assert.equal(await vault.get(oauth.credentialRef), null);
  } finally {
    oauth.close();
  }
});
test("OAuth success rejects incorrect state; stores tokens only in vault; disconnect clears them", async () => {
  let authUrl = "",
    exchanges = 0;
  const vault = new Vault(),
    oauth = new GmailOAuth(
      vault,
      { tenant: "agency", owner: "owner" },
      async (url) => {
        authUrl = url;
      },
      async (input, init) => {
        if (String(input).includes("/token")) {
          exchanges++;
          const body = new URLSearchParams(String(init?.body));
          assert.ok(body.get("code_verifier")!.length >= 43);
          assert.equal(body.get("grant_type"), "authorization_code");
          return json({
            access_token: "synthetic-access",
            refresh_token: "synthetic-refresh",
            expires_in: 3600,
            scope: [GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE, "openid", "email"].join(
              " ",
            ),
          });
        }
        return json({
          sub: "account-one",
          email: payload.from,
          email_verified: true,
        });
      },
    );
  try {
    await oauth.configure({
      clientId: "test.apps.googleusercontent.com",
      clientSecret: "synthetic-client",
    });
    await oauth.connect(true);
    const auth = new URL(authUrl),
      callback = new URL(auth.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      state: "f".repeat(64),
      code: "synthetic-code",
    }).toString();
    assert.equal((await fetch(callback)).status, 400);
    assert.equal(exchanges, 0);
    callback.searchParams.set("state", auth.searchParams.get("state")!);
    await fetch(callback);
    const status = await oauth.status();
    assert.equal(status.state, "connected");
    assert.equal(status.account, payload.from);
    assert.equal(status.verification, true);
    assert.equal(JSON.stringify(status).includes("synthetic-access"), false);
    assert.ok(await vault.get(oauth.credentialRef));
    await oauth.disconnect();
    assert.equal(await vault.get(oauth.credentialRef), null);
    assert.equal((await oauth.status()).state, "not_connected");
  } finally {
    oauth.close();
  }
});
test("OAuth expiry invalidates pending callback", async () => {
  const vault = new Vault(),
    oauth = new GmailOAuth(
      vault,
      { tenant: "agency", owner: "owner" },
      async () => {},
      fetch,
      10,
    );
  try {
    await oauth.configure({
      clientId: "test.apps.googleusercontent.com",
      clientSecret: "synthetic-client",
    });
    await oauth.connect(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await oauth.status()).error, "GMAIL_OAUTH_TIMEOUT");
    assert.equal(await vault.get(oauth.credentialRef), null);
  } finally {
    oauth.close();
  }
});
test("refresh completing after disconnect cannot resurrect credentials", async () => {
  let release!: (v: Response) => void;
  const f = await setup(
    async () => new Promise<Response>((resolve) => (release = resolve)),
  );
  try {
    await f.vault.set(
      f.oauth.credentialRef,
      JSON.stringify({ ...credential(), expiresAt: 0 }),
    );
    const refresh = f.oauth.credential();
    await new Promise((resolve) => setImmediate(resolve));
    await f.oauth.disconnect();
    release(json({ access_token: "synthetic-late", expires_in: 3600 }));
    await assert.rejects(refresh);
    assert.equal(await f.vault.get(f.oauth.credentialRef), null);
  } finally {
    f.close();
  }
});
test("send timeout is UNKNOWN and subsequent reconcile cannot repeat POST", async () => {
  let sends = 0;
  const f = await setup(async (_input, init) => {
    if (init?.method === "POST") {
      sends++;
      return new Promise((_resolve, reject) =>
        init.signal!.addEventListener(
          "abort",
          () => reject(new Error("synthetic timeout")),
          { once: true },
        ),
      );
    }
    return json({ messages: [] });
  });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      f.provider.send(payload, key, signal()),
      (e: unknown) =>
        e instanceof EmailDispatchError && e.certainty === "unknown",
    );
    assert.equal(await f.provider.reconcile(key, signal()), null);
    await assert.rejects(f.provider.send(payload, key, signal()));
    assert.equal(sends, 1);
  } finally {
    clearTimeout(keepAlive);
    f.close();
  }
});
