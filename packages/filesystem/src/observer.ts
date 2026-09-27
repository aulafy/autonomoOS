import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import type { Observation, ObservationRequest, Observer } from "@agent-world/observation";
import { postconditionHash } from "@agent-world/observation";
import type { ResourceRegistry } from "@agent-world/resources";
import { MAX_FILE_BYTES } from "./executor.js";
import { FilesystemWorkspace } from "./workspace.js";

export interface FileDigest { sha256: string; byteLength: number; }

/** Reads the actual target through its own descriptor, never executor metadata. */
export class FilesystemObserver implements Observer {
  readonly descriptor = { id: "filesystem-observer", implementation: "independent local file read",
    sourceType: "filesystem" as const, independence: "independent_local" as const,
    strength: "strong" as const, authenticated: true, metadata: {} };

  constructor(private readonly workspace: FilesystemWorkspace,
    private readonly resources: ResourceRegistry,
    private readonly now: () => number = Date.now) {}

  async observe(request: ObservationRequest, signal: AbortSignal): Promise<Observation> {
    const id = request.subject.resourceIds[0];
    const expected = request.expectedPostcondition;
    const base = { id: randomUUID(), subject: structuredClone(request.subject),
      observerId: this.descriptor.id, source: "filesystem" as const,
      observedAt: this.now(), expectedPostcondition: structuredClone(expected),
      expectedPostconditionHash: postconditionHash(expected),
      observedResourceGenerations: expected.kind === "filesystem_read" && id && this.resources.get(id)
        ? { [id]: this.resources.get(id)!.generation } : {}, metadata: {} };
    if (signal.aborted || !id || request.subject.resourceIds.length !== 1 ||
      expected.resourceIds.length !== 1 || expected.resourceIds[0] !== id ||
      !["filesystem_write", "filesystem_read"].includes(expected.kind)) {
      return { ...base, status: "unknown", evidence: [], reason: "INVALID_FILE_OBSERVATION" };
    }
    try {
      const path = this.workspace.pathForObservation(id);
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("FILE_UNOBSERVABLE");
        bytes = readFileSync(fd);
      } finally { closeSync(fd); }
      const actual: FileDigest = { sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.length };
      const wanted = expected.expected as Partial<FileDigest> | null;
      const confirmed = expected.kind === "filesystem_read" ||
        (wanted?.sha256 === actual.sha256 && wanted?.byteLength === actual.byteLength);
      return { ...base, status: confirmed ? "confirmed" : "contradicted",
        evidence: [{ kind: "hash", reference: `${id}:${actual.sha256}`,
          metadata: { sha256: actual.sha256, byteLength: actual.byteLength } }],
        reason: confirmed ? "FILE_BYTES_MATCH" : "FILE_BYTES_DIFFER" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { ...base, status: "contradicted", evidence: [{ kind: "resource",
          reference: `${id}:absent`, metadata: { absent: true } }],
          reason: "FILE_ABSENT" };
      }
      return { ...base, status: "unknown", evidence: [], reason: "FILE_UNOBSERVABLE" };
    }
  }
}
