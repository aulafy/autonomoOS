import test from "node:test";
import assert from "node:assert/strict";
import {
  GmailOAuth,
  GMAIL_SEND_SCOPE,
  GMAIL_READ_SCOPE,
} from "../src/gmail-oauth.js";
import { GmailEmailProvider } from "../src/gmail-email-provider.js";
import type { CredentialVault } from "../src/gmail-keychain.js";

/** Vault whose reads yield to the event loop, as the Keychain helper does. */
class SlowVault implements CredentialVault {
  values = new Map<string, string>();
  async get(k: string) {
    await new Promise((r) => setTimeout(r, 5));
    return this.values.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.values.set(k, v);
  }
  async delete(k: string) {
    this.values.delete(k);
  }
}
const credential = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  expiresAt: Date.now() + 3600000,
  clientId: "test.apps.googleusercontent.com",
  clientSecret: "synthetic-client",
  account: "owner@example.test",
  subject: "account-one",
  scopes: [GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE, "openid", "email"],
  generation: "b".repeat(64),
};
async function setup() {
  const vault = new SlowVault(),
    oauth = new GmailOAuth(
      vault,
      { tenant: "agency", owner: "owner" },
      async () => {},
      async () => {
        throw new Error("no network in this test");
      },
    );
  await vault.set(oauth.credentialRef, JSON.stringify(credential));
  const provider = new GmailEmailProvider(oauth, ":memory:");
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

test("status poll in flight does not transiently clear the approval binding", async () => {
  const f = await setup();
  try {
    const before = f.provider.approvalBinding();
    const poll = f.provider.status();
    // Synchronous reads while the poll awaits the vault (UI polling vs execute/plan).
    let settled = false;
    void poll.then(() => (settled = true));
    const failures: string[] = [];
    while (!settled) {
      try {
        assert.equal(f.provider.approvalBinding(), before);
        assert.equal(f.provider.account(), "owner@example.test");
      } catch (e) {
        failures.push((e as Error).message);
      }
      await new Promise((r) => setTimeout(r, 1));
    }
    await poll;
    assert.deepEqual(failures, []);
    assert.equal(f.provider.approvalBinding(), before);
  } finally {
    f.close();
  }
});

test("disconnect still clears binding and account once status settles", async () => {
  const f = await setup();
  try {
    await f.oauth.disconnect();
    await f.provider.status();
    assert.throws(() => f.provider.approvalBinding(), /GMAIL_NOT_CONNECTED/);
    assert.throws(() => f.provider.account(), /GMAIL_NOT_CONNECTED/);
  } finally {
    f.close();
  }
});

test("reconnection with a new generation changes the binding; an older poll cannot restore it", async () => {
  const f = await setup();
  try {
    const old = f.provider.approvalBinding();
    const stalePoll = f.provider.status();
    await f.vault.set(
      f.oauth.credentialRef,
      JSON.stringify({ ...credential, generation: "c".repeat(64) }),
    );
    const fresh = f.provider.status();
    await Promise.all([stalePoll, fresh]);
    await f.provider.status();
    assert.notEqual(f.provider.approvalBinding(), old);
  } finally {
    f.close();
  }
});

test("failed older status poll cannot mark a newer successful connection as erroneous", async () => {
  let rejectOld!: (e: Error) => void;
  let entered!: () => void;
  const reached = new Promise<void>((r) => {
    entered = r;
  });
  const old = new Promise<never>((_, reject) => {
    rejectOld = reject;
  });
  let calls = 0,
    errors = 0;
  const oauth = {
    status: async () => ({ state: "connected", account: credential.account }),
    credential: async () => {
      if (++calls === 1) {
        entered();
        return old;
      }
      return { ...credential, generation: "c".repeat(64) };
    },
    markError: () => {
      errors++;
    },
  } as unknown as GmailOAuth;
  const p = new GmailEmailProvider(oauth, ":memory:");
  try {
    const stale = p.status();
    await reached;
    await p.status();
    const binding = p.approvalBinding();
    rejectOld(new Error("synthetic obsolete credential failure"));
    await stale;
    assert.equal(errors, 0);
    assert.equal(p.approvalBinding(), binding);
    assert.equal(p.account(), credential.account);
  } finally {
    p.close();
  }
});
