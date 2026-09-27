import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { ApiEndpointBinding } from "./api-resource.js";

export class ApiBoundaryError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ApiBoundaryError"; }
}

function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    if (a === undefined || b === undefined || c === undefined ||
      a === 0 || a === 10 || a === 127 || a === 169 || a >= 224 ||
      a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) ||
      a === 100 && b >= 64 && b <= 127 ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
      a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  // H4 has no complete IPv6 special-purpose registry. Deny it by default,
  // including mapped, ULA, link-local and metadata destinations.
  return false;
}

export async function resolveDestination(binding: ApiEndpointBinding): Promise<{
  address: string; family: 4 | 6; url: URL }> {
  const url = new URL(binding.origin);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiBoundaryError("UNSUPPORTED_SCHEME");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (binding.allowFixtureLoopback) {
    if (url.protocol !== "http:" || !["127.0.0.1", "::1"].includes(host)) {
      throw new ApiBoundaryError("FIXTURE_LOOPBACK_REQUIRED");
    }
    return { address: host, family: isIP(host) as 4 | 6, url };
  }
  if (url.protocol !== "https:") throw new ApiBoundaryError("HTTPS_REQUIRED");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] :
    await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) {
    throw new ApiBoundaryError("DESTINATION_ADDRESS_DENIED");
  }
  const selected = addresses[0]!;
  return { address: selected.address, family: selected.family as 4 | 6, url };
}

export interface ApiResponse { status: number; body: string; byteLength: number; }

/** No automatic redirects; DNS result is pinned for this one request. */
export async function sendApiRequest(binding: ApiEndpointBinding, method: "GET" | "POST",
  path: string, headers: Record<string, string>, body: string | undefined,
  signal: AbortSignal): Promise<ApiResponse> {
  if ((method === "POST" && path !== binding.createPath) ||
    (method === "GET" && !/^\/items\/by-idempotency-key\/[a-f0-9]{64}$/.test(path)) ||
    (method !== "POST" && method !== "GET") ||
    Buffer.byteLength(body ?? "", "utf8") > 65536) {
    throw new ApiBoundaryError("REQUEST_NOT_ALLOWED");
  }
  const { address, family, url } = await resolveDestination(binding);
  if (signal.aborted) throw new ApiBoundaryError("REQUEST_ABORTED_BEFORE_SEND");
  return new Promise<ApiResponse>((resolve, reject) => {
    const make = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = make({ hostname: address, family,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
      method, path, agent: false, servername: url.hostname,
      headers: { ...headers, Host: url.host }, signal,
      timeout: binding.timeoutMs ?? 10000,
      lookup: (_hostname, _options, callback) => callback(null, address, family) }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65536) req.destroy(new ApiBoundaryError("RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"), byteLength: size }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new ApiBoundaryError("REQUEST_TIMEOUT")));
    req.on("error", reject);
    req.end(body);
  });
}
