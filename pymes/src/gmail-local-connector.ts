import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { MacKeychainVault, type CredentialVault } from "./gmail-keychain.js";
import { GmailOAuth } from "./gmail-oauth.js";
import { GmailEmailProvider } from "./gmail-email-provider.js";
export class GmailLocalConnector {
  readonly oauth: GmailOAuth;
  readonly provider: GmailEmailProvider;
  constructor(
    readonly owner: string,
    tenant: string,
    path: string,
    vault: CredentialVault,
    launch: (url: string) => Promise<void>,
    fetcher: typeof fetch = fetch,
  ) {
    this.oauth = new GmailOAuth(vault, { tenant, owner }, launch, fetcher);
    this.provider = new GmailEmailProvider(this.oauth, path, fetcher);
  }
  private scope(owner: string) {
    if (owner !== this.owner) throw new Error("GMAIL_OWNER_SCOPE_DENIED");
  }
  async status(owner: string) {
    this.scope(owner);
    return this.provider.status();
  }
  async configure(owner: string, body: unknown) {
    this.scope(owner);
    await this.oauth.configure(body);
    return this.status(owner);
  }
  async connect(
    owner: string,
    verification: boolean,
    authorized: () => boolean,
  ) {
    this.scope(owner);
    return this.oauth.connect(verification, authorized);
  }
  async check(owner: string) {
    this.scope(owner);
    await this.oauth.check();
    return this.status(owner);
  }
  async disconnect(owner: string) {
    this.scope(owner);
    await this.oauth.disconnect();
    return this.status(owner);
  }
  close() {
    this.oauth.close();
    this.provider.close();
  }
}
export async function openLocalGmail(
  owner: string,
  tenant: string,
  path: string,
  helper: string,
  configPath?: string,
) {
  const connector = new GmailLocalConnector(
    owner,
    tenant,
    path,
    new MacKeychainVault(helper),
    (url) =>
      new Promise<void>((resolve, reject) => {
        const parsed = new URL(url);
        if (
          parsed.origin !== "https://accounts.google.com" ||
          parsed.pathname !== "/o/oauth2/v2/auth"
        )
          return reject(new Error("INVALID_OAUTH_DESTINATION"));
        const child = spawn("/usr/bin/open", [url], { stdio: "ignore" });
        child.on("error", () => reject(new Error("GMAIL_BROWSER_UNAVAILABLE")));
        child.on("close", (code) =>
          code === 0
            ? resolve()
            : reject(new Error("GMAIL_BROWSER_UNAVAILABLE")),
        );
      }),
  );
  try {
    if (configPath) {
      const info = await readFile(configPath, "utf8");
      if (Buffer.byteLength(info) > 65536)
        throw new Error("INVALID_GMAIL_CLIENT");
      let installed;
      try {
        installed = JSON.parse(info).installed;
      } catch {
        throw new Error("INVALID_GMAIL_CLIENT");
      }
      if (!installed) throw new Error("GMAIL_DESKTOP_CLIENT_REQUIRED");
      await connector.configure(owner, {
        clientId: installed.client_id,
        clientSecret: installed.client_secret,
      });
    }
    await connector.status(owner);
    return connector;
  } catch {
    connector.close();
    throw new Error("GMAIL_LOCAL_SETUP_FAILED");
  }
}
