import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync,
  openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ExecutorContext, SideEffectExecutor } from "@agent-world/control-plane";
import type { DispatchResult } from "@agent-world/effects";
import type { ResourceId } from "@agent-world/resources";
import { FilesystemBoundaryError, FilesystemWorkspace } from "./workspace.js";

export const MAX_FILE_BYTES = 1024 * 1024;
export type WriteMode = "create" | "replace";

export function expectedBytes(parameters: Record<string, unknown>): {
  bytes: Buffer; mode: WriteMode; sha256: string;
} {
  const { content, mode } = parameters;
  if (typeof content !== "string" || (mode !== "create" && mode !== "replace")) {
    throw new FilesystemBoundaryError("INVALID_WRITE_PARAMETERS");
  }
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > MAX_FILE_BYTES) throw new FilesystemBoundaryError("FILE_TOO_LARGE");
  return { bytes, mode, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function fsyncParent(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dirname(path), constants.O_RDONLY);
    fsyncSync(fd);
  } finally { if (fd !== undefined) closeSync(fd); }
}

function regularFile(path: string): boolean {
  try {
    const info = lstatSync(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Receives only a canonical resource after C11 admission and commit gate. */
export class FilesystemWriteExecutor implements SideEffectExecutor {
  readonly id = "filesystem-write";
  constructor(private readonly workspace: FilesystemWorkspace,
    private readonly afterTargetMutation?: () => void) {}

  async dispatch(context: ExecutorContext, signal: AbortSignal): Promise<DispatchResult> {
    let target: string;
    let bytes: Buffer;
    let mode: WriteMode;
    let sha256: string;
    try {
      if (context.resourceIds.length !== 1) throw new FilesystemBoundaryError("INVALID_FILE_RESOURCE");
      target = this.workspace.pathForResource(context.resourceIds[0]!, "write");
      ({ bytes, mode, sha256 } = expectedBytes(context.parameters));
      if (signal.aborted) throw new FilesystemBoundaryError("DISPATCH_ABORTED");
      const exists = regularFile(target);
      if (mode === "create" && exists) throw new FilesystemBoundaryError("FILE_EXISTS");
      if (mode === "replace" && !exists) throw new FilesystemBoundaryError("FILE_NOT_FOUND");
    } catch (error) {
      return { kind: "reported_failure", certainty: "certified_not_started",
        reason: error instanceof Error ? error.message : "INVALID_FILE_WRITE", metadata: {} };
    }
    const temporary = join(dirname(target), `.${basename(target)}.awos-${randomUUID()}.tmp`);
    let tempExists = false;
    let mutationMayHaveStarted = false;
    try {
      const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL |
        constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      tempExists = true;
      try {
        let offset = 0;
        while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      if (signal.aborted) throw new FilesystemBoundaryError("DISPATCH_ABORTED");
      this.workspace.pathForResource(context.resourceIds[0]!, "write");
      if (mode === "create") {
        if (regularFile(target)) throw new FilesystemBoundaryError("FILE_EXISTS");
        mutationMayHaveStarted = true;
        linkSync(temporary, target); // Atomic no-clobber publication.
        unlinkSync(temporary);
        tempExists = false;
      } else {
        if (!regularFile(target)) throw new FilesystemBoundaryError("FILE_NOT_FOUND");
        mutationMayHaveStarted = true;
        renameSync(temporary, target); // Atomic replacement on the same filesystem.
        tempExists = false;
      }
      this.afterTargetMutation?.();
      fsyncParent(target);
      return { kind: "reported_success", metadata: { sha256, byteLength: bytes.length } };
    } catch (error) {
      return { kind: "reported_failure",
        certainty: mutationMayHaveStarted ? "may_have_started" : "certified_not_started",
        reason: error instanceof Error ? error.message : "FILESYSTEM_WRITE_ERROR", metadata: {} };
    } finally {
      if (tempExists) {
        try { unlinkSync(temporary); } catch { /* crash debris is never executed */ }
      }
    }
  }
}

/** A read produces host-held bytes, never a direct model-visible filesystem handle. */
export class FilesystemReadExecutor implements SideEffectExecutor {
  readonly id = "filesystem-read";
  private readonly results = new Map<string, Buffer>();
  constructor(private readonly workspace: FilesystemWorkspace) {}

  async dispatch(context: ExecutorContext, signal: AbortSignal): Promise<DispatchResult> {
    try {
      if (signal.aborted || context.resourceIds.length !== 1) {
        throw new FilesystemBoundaryError("INVALID_FILE_READ");
      }
      const path = this.workspace.pathForResource(context.resourceIds[0]!, "read");
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.size > MAX_FILE_BYTES) {
          throw new FilesystemBoundaryError("INVALID_FILE_READ");
        }
        bytes = readFileSync(fd);
      } finally { closeSync(fd); }
      this.results.set(context.effectId, Buffer.from(bytes));
      return { kind: "reported_success", metadata: {
        sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length } };
    } catch (error) {
      return { kind: "reported_failure", certainty: "may_have_started",
        reason: error instanceof Error ? error.message : "FILESYSTEM_READ_ERROR", metadata: {} };
    }
  }

  takeReadResult(effectId: string): Buffer | null {
    const value = this.results.get(effectId) ?? null;
    this.results.delete(effectId);
    return value ? Buffer.from(value) : null;
  }
}
