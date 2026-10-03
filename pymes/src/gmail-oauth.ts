import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { emailHash } from "./email-provider.js";
import type { CredentialVault } from "./gmail-keychain.js";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_READ_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
const IDENTITY_SCOPES = ["openid", "email"];
export interface GmailCredential {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  clientId: string;
  clientSecret: string;
  account: string;
  subject: string;
  scopes: string[];
  generation: string;
}
export type GmailConnectionView = {
  state: "not_connected" | "connecting" | "connected" | "authorization_error";
  account: string | null;
  scopes: string[];
  lastCheckedAt: number | null;
  verification: boolean;
  error: string | null;
  configured: boolean;
};
export async function googleJson(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ status: number; value: Record<string, unknown> }> {
  try {
    const r = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: init.signal ?? AbortSignal.timeout(10000),
    });
    const length = r.headers.get("content-length");
    if (length && Number(length) > 200000) throw 0;
    const reader = r.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 200000) throw 0;
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = {};
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
    return { status: r.status, value };
  } catch {
    throw new Error("GOOGLE_REQUEST_UNCONFIRMED");
  }
}
/** Credentials exist only in the vault and short-lived process memory. */
export class GmailOAuth {
  private pending: {
    server: Server;
    timer: ReturnType<typeof setTimeout>;
    state: string;
    generation: number;
    cancel: () => void;
  } | null = null;
  private refresh: Promise<GmailCredential> | null = null;
  private epoch = 0;
  private writes: Promise<void> = Promise.resolve();
  private mutate(operation: () => Promise<void>) {
    const result = this.writes.then(operation);
    this.writes = result.catch(() => {});
    return result;
  }
  private persist(
    c: GmailCredential,
    epoch: number,
    authorized: () => boolean = () => true,
  ) {
    return this.mutate(async () => {
      if (epoch !== this.epoch || !authorized())
        throw new Error("GMAIL_DISCONNECTED");
      await this.vault.set(this.credentialRef, JSON.stringify(c));
      if (epoch !== this.epoch || !authorized()) {
        await this.vault.delete(this.credentialRef);
        throw new Error("GMAIL_DISCONNECTED");
      }
    });
  }
  permits(c: GmailCredential) {
    return this.view.state === "connected" && this.view.account === c.account;
  }

  private view: GmailConnectionView = {
    state: "not_connected",
    account: null,
    scopes: [],
    lastCheckedAt: null,
    verification: false,
    error: null,
    configured: false,
  };
  readonly credentialRef: string;
  readonly configRef: string;
  constructor(
    private vault: CredentialVault,
    scope: { tenant: string; owner: string },
    private launch: (url: string) => Promise<void>,
    private fetcher: typeof fetch = fetch,
    private callbackTimeoutMs = 300000,
  ) {
    if (
      !Number.isInteger(callbackTimeoutMs) ||
      callbackTimeoutMs < 1 ||
      callbackTimeoutMs > 300000
    )
      throw new Error("INVALID_OAUTH_TIMEOUT");
    this.credentialRef = emailHash({ type: "gmail-credential", ...scope });
    this.configRef = emailHash({ type: "gmail-client", ...scope });
  }
  async configure(config: unknown) {
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw new Error("INVALID_GMAIL_CLIENT");
    const c = config as Record<string, unknown>;
    if (
      Object.keys(c).sort().join(",") !== "clientId,clientSecret" ||
      typeof c.clientId !== "string" ||
      !/^[-a-zA-Z0-9_.]+\.apps\.googleusercontent\.com$/.test(c.clientId) ||
      typeof c.clientSecret !== "string" ||
      !c.clientSecret ||
      c.clientSecret.length > 4096
    )
      throw new Error("INVALID_GMAIL_CLIENT");
    if (this.pending) throw new Error("GMAIL_CONNECTING");
    await this.vault.set(this.configRef, JSON.stringify(c));
    this.view.configured = true;
  }
  async status(): Promise<GmailConnectionView> {
    if (this.view.state !== "connecting") {
      const raw = await this.vault.get(this.credentialRef);
      if (raw && this.view.state !== "authorization_error") {
        const c = this.parse(raw);
        this.view = {
          state: "connected",
          account: c.account,
          scopes: c.scopes,
          lastCheckedAt: this.view.lastCheckedAt,
          verification: c.scopes.includes(GMAIL_READ_SCOPE),
          error: null,
          configured: true,
        };
      } else if (!raw && this.view.state !== "authorization_error")
        this.view = {
          ...this.view,
          state: "not_connected",
          account: null,
          scopes: [],
          verification: false,
        };
      this.view.configured = !!(await this.vault.get(this.configRef));
    }
    return structuredClone(this.view);
  }
  private parse(raw: string): GmailCredential {
    try {
      const c = JSON.parse(raw) as GmailCredential;
      if (
        typeof c.accessToken !== "string" ||
        !c.accessToken ||
        typeof c.refreshToken !== "string" ||
        !c.refreshToken ||
        !Number.isFinite(c.expiresAt) ||
        typeof c.clientId !== "string" ||
        typeof c.clientSecret !== "string" ||
        typeof c.subject !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.account) ||
        !Array.isArray(c.scopes) ||
        !c.scopes.includes(GMAIL_SEND_SCOPE) ||
        typeof c.generation !== "string"
      )
        throw 0;
      return c;
    } catch {
      throw new Error("GMAIL_CREDENTIAL_INVALID");
    }
  }
  private async exchange(body: URLSearchParams) {
    const response = await googleJson(
      this.fetcher,
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
    );
    if (response.status !== 200) {
      this.markError();
      throw new Error("GMAIL_AUTHORIZATION_FAILED");
    }
    return response.value;
  }
  markError() {
    this.view.state = "authorization_error";
    this.view.error = "GMAIL_AUTHORIZATION_REQUIRED";
  }
  async credential(): Promise<GmailCredential> {
    if (this.view.state === "authorization_error")
      throw new Error("GMAIL_AUTHORIZATION_REQUIRED");
    const readEpoch = this.epoch;
    const raw = await this.vault.get(this.credentialRef);
    if (readEpoch !== this.epoch || !raw)
      throw new Error("GMAIL_NOT_CONNECTED");
    let c = this.parse(raw);
    if (c.expiresAt > Date.now() + 30000) return c;
    if (this.refresh) return this.refresh;
    const epoch = this.epoch;
    this.refresh = (async () => {
      const token = await this.exchange(
        new URLSearchParams({
          client_id: c.clientId,
          client_secret: c.clientSecret,
          refresh_token: c.refreshToken,
          grant_type: "refresh_token",
        }),
      );
      if (
        typeof token.access_token !== "string" ||
        !Number.isFinite(token.expires_in) ||
        Number(token.expires_in) <= 0
      )
        throw new Error("GMAIL_TOKEN_INVALID");
      if (typeof token.scope === "string") {
        const scopes = token.scope.split(" ");
        if (
          !scopes.includes(GMAIL_SEND_SCOPE) ||
          (c.scopes.includes(GMAIL_READ_SCOPE) &&
            !scopes.includes(GMAIL_READ_SCOPE))
        ) {
          this.markError();
          throw new Error("GMAIL_SCOPES_CHANGED");
        }
      }
      c = {
        ...c,
        accessToken: token.access_token,
        expiresAt: Date.now() + Number(token.expires_in) * 1000,
      };
      if (epoch !== this.epoch) throw new Error("GMAIL_DISCONNECTED");
      await this.persist(c, epoch);
      return c;
    })().finally(() => {
      this.refresh = null;
    });
    return this.refresh;
  }
  async check() {
    const c = await this.credential(),
      r = await googleJson(
        this.fetcher,
        "https://openidconnect.googleapis.com/v1/userinfo",
        { headers: { Authorization: "Bearer " + c.accessToken } },
      );
    if (
      r.status !== 200 ||
      r.value.sub !== c.subject ||
      r.value.email !== c.account ||
      r.value.email_verified !== true
    ) {
      this.markError();
      throw new Error("GMAIL_ACCOUNT_NOT_CONFIRMED");
    }
    this.view.lastCheckedAt = Date.now();
    return this.status();
  }
  async connect(
    verification: boolean,
    authorized: () => boolean = () => true,
  ): Promise<GmailConnectionView> {
    if (this.pending) throw new Error("GMAIL_CONNECTING");
    if ((await this.status()).state === "connected")
      throw new Error("GMAIL_DISCONNECT_FIRST");
    const raw = await this.vault.get(this.configRef);
    if (!raw) throw new Error("GMAIL_CLIENT_NOT_CONFIGURED");
    let config: { clientId: string; clientSecret: string };
    try {
      config = JSON.parse(raw);
    } catch {
      throw new Error("GMAIL_CLIENT_NOT_CONFIGURED");
    }
    const state = randomBytes(32).toString("hex"),
      verifier = randomBytes(48).toString("base64url"),
      challenge = (await import("node:crypto"))
        .createHash("sha256")
        .update(verifier)
        .digest("base64url"),
      epoch = ++this.epoch;
    const scopes = [
      GMAIL_SEND_SCOPE,
      ...IDENTITY_SCOPES,
      ...(verification ? [GMAIL_READ_SCOPE] : []),
    ];
    let consumed = false;
    let redirect = "";
    const server = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'unsafe-inline'",
      );
      if (
        req.method !== "GET" ||
        req.headers.host !== new URL(redirect).host ||
        req.url!.length > 8192
      ) {
        res.writeHead(400);
        res.end("Solicitud no válida");
        return;
      }
      const url = new URL(req.url!, redirect);
      if (url.pathname !== "/oauth/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const returned = url.searchParams.get("state") ?? "";
      if (
        ["state", "code", "error"].some(
          (k) => url.searchParams.getAll(k).length > 1,
        ) ||
        !/^[a-f0-9]{64}$/.test(returned) ||
        !timingSafeEqual(Buffer.from(returned), Buffer.from(state)) ||
        consumed ||
        epoch !== this.epoch
      ) {
        res.writeHead(400);
        res.end("Solicitud no válida");
        return;
      }
      consumed = true;
      try {
        if (url.searchParams.has("error"))
          throw new Error("GMAIL_OAUTH_CANCELLED");
        const code = url.searchParams.get("code");
        if (!code || code.length > 4096 || !authorized())
          throw new Error("GMAIL_AUTHORIZATION_FAILED");
        const token = await this.exchange(
          new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            code_verifier: verifier,
            redirect_uri: redirect,
            grant_type: "authorization_code",
          }),
        );
        const granted =
          typeof token.scope === "string" ? token.scope.split(" ") : [];
        if (
          !granted.includes(GMAIL_SEND_SCOPE) ||
          (verification && !granted.includes(GMAIL_READ_SCOPE)) ||
          typeof token.access_token !== "string" ||
          typeof token.refresh_token !== "string" ||
          !Number.isFinite(token.expires_in) ||
          Number(token.expires_in) <= 0
        )
          throw new Error("GMAIL_SCOPES_OR_TOKEN_INVALID");
        const identity = await googleJson(
            this.fetcher,
            "https://openidconnect.googleapis.com/v1/userinfo",
            { headers: { Authorization: "Bearer " + token.access_token } },
          ),
          user = identity.value;
        if (
          identity.status !== 200 ||
          typeof user.sub !== "string" ||
          typeof user.email !== "string" ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email) ||
          user.email_verified !== true ||
          epoch !== this.epoch ||
          !authorized()
        )
          throw new Error("GMAIL_ACCOUNT_NOT_CONFIRMED");
        const credential: GmailCredential = {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt: Date.now() + Number(token.expires_in) * 1000,
          ...config,
          account: user.email,
          subject: user.sub,
          scopes: granted,
          generation: randomBytes(32).toString("hex"),
        };
        await this.persist(credential, epoch, authorized);
        this.view = {
          state: "connected",
          account: user.email,
          scopes: granted,
          lastCheckedAt: Date.now(),
          verification,
          configured: true,
          error: null,
        };
        res.end(
          '<!doctype html><script>history.replaceState(null,"","/")</script><p>Gmail conectado. Cierra esta ventana y vuelve a Autónomo OS.</p>',
        );
      } catch (error) {
        if (epoch === this.epoch) {
          this.view.state = "authorization_error";
          this.view.error =
            error instanceof Error && error.message === "GMAIL_OAUTH_CANCELLED"
              ? "GMAIL_OAUTH_CANCELLED"
              : "GMAIL_AUTHORIZATION_REQUIRED";
        }
        res.end(
          '<!doctype html><script>history.replaceState(null,"","/")</script><p>Conexión no confirmada. Vuelve a Autónomo OS.</p>',
        );
      } finally {
        if (this.pending?.generation === epoch) {
          clearTimeout(this.pending.timer);
          this.pending = null;
        }
        server.close();
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", () =>
        reject(new Error("GMAIL_CALLBACK_UNAVAILABLE")),
      );
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("GMAIL_CALLBACK_UNAVAILABLE");
    redirect = `http://127.0.0.1:${address.port}/oauth/callback`;
    const timer = setTimeout(() => {
      if (epoch === this.epoch) {
        ++this.epoch;
        this.view.state = "authorization_error";
        this.view.error = "GMAIL_OAUTH_TIMEOUT";
        this.pending = null;
      }
      server.close();
    }, this.callbackTimeoutMs);
    timer.unref();
    this.pending = {
      server,
      timer,
      state,
      generation: epoch,
      cancel: () => {
        clearTimeout(timer);
        server.close();
      },
    };
    this.view = {
      ...this.view,
      state: "connecting",
      error: null,
      scopes,
      verification,
    };
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
    }).toString();
    try {
      if (!authorized()) throw 0;
      await this.launch(url.toString());
    } catch {
      this.pending?.cancel();
      this.pending = null;
      this.view.state = "authorization_error";
      this.view.error = "GMAIL_BROWSER_UNAVAILABLE";
      throw new Error("GMAIL_BROWSER_UNAVAILABLE");
    }
    return structuredClone(this.view);
  }
  async disconnect() {
    ++this.epoch;
    this.pending?.cancel();
    this.pending = null;
    await this.mutate(() => this.vault.delete(this.credentialRef));
    this.view = {
      state: "not_connected",
      account: null,
      scopes: [],
      lastCheckedAt: Date.now(),
      verification: false,
      error: null,
      configured: !!(await this.vault.get(this.configRef)),
    };
    return structuredClone(this.view);
  }
  close() {
    ++this.epoch;
    this.pending?.cancel();
    this.pending = null;
  }
}
