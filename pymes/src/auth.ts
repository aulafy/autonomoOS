import { createHash } from "node:crypto";

/** Stable storage key for bearer sessions; raw credentials never become keys. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
