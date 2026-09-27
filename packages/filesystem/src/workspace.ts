import { createHash } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { mintResourceId, type ResourceId, type ResourceRecord,
  type ResourceRegistry, type ResourceSinkMetadata, type ResourceDataLabel } from
  "@agent-world/resources";

export class FilesystemBoundaryError extends Error {
  constructor(readonly code: string) { super(code); this.name = "FilesystemBoundaryError"; }
}

/** Conservative logical names; no path normalization is silently applied. */
export function validateLogicalPath(value: string): string {
  if (!value || value !== value.normalize("NFKC") || value !== value.toLowerCase() ||
    value !== value.trim() || value.includes("\0") || value.includes("\\") ||
    isAbsolute(value) || value.startsWith("/") || value.includes(":") ||
    value.split("/").some(segment => !segment || segment === "." ||
      segment === ".." || !/^[a-z0-9][a-z0-9._-]*$/.test(segment) ||
      segment.endsWith(".") || segment.endsWith(" "))) {
    throw new FilesystemBoundaryError("INVALID_LOGICAL_PATH");
  }
  return value;
}

export interface FileRegistration {
  relativePath: string;
  displayName?: string;
  label?: ResourceDataLabel | null;
  sink?: ResourceSinkMetadata | null;
  readable?: boolean;
  writable?: boolean;
}

/** Host-owned binding of C2 file resources to one real workspace root. */
export class FilesystemWorkspace {
  readonly root: string;
  readonly rootBinding: string;
  readonly directoryId: ResourceId;

  constructor(root: string, private readonly resources: ResourceRegistry) {
    if (!root || !isAbsolute(root)) throw new FilesystemBoundaryError("INVALID_WORKSPACE_ROOT");
    const actual = realpathSync(root);
    if (!statSync(actual).isDirectory()) throw new FilesystemBoundaryError("INVALID_WORKSPACE_ROOT");
    this.root = actual;
    this.rootBinding = createHash("sha256").update(actual).digest("hex");
    this.directoryId = mintResourceId("directory", "workspace");
  }

  registerRoot(): ResourceRecord {
    const current = this.resources.get(this.directoryId);
    if (current) {
      if (current.kind !== "directory" || current.source !== "filesystem_resolver" ||
        current.metadata.rootBinding !== this.rootBinding) {
        throw new FilesystemBoundaryError("WORKSPACE_BINDING_CHANGED");
      }
      return current;
    }
    return this.resources.register({ id: this.directoryId, kind: "directory",
      displayName: "Workspace", aliases: [], parentId: null, dataLabel: null,
      exclusivity: "shared", sink: null, source: "filesystem_resolver",
      metadata: { rootBinding: this.rootBinding } });
  }

  registerFile(input: FileRegistration): ResourceRecord {
    const relativePath = validateLogicalPath(input.relativePath);
    this.registerRoot();
    this.pathForRelative(relativePath, true);
    const id = mintResourceId("file", `workspace/${relativePath}`);
    if (this.resources.has(id)) throw new FilesystemBoundaryError("FILE_ALREADY_REGISTERED");
    if (input.readable === false && input.writable === false) {
      throw new FilesystemBoundaryError("FILE_HAS_NO_AFFORDANCE");
    }
    return this.resources.register({ id, kind: "file",
      displayName: input.displayName ?? basename(relativePath),
      aliases: [relativePath], parentId: this.directoryId,
      dataLabel: input.label ?? null, exclusivity: "single_writer",
      sink: input.sink ?? null, source: "filesystem_resolver",
      metadata: { rootBinding: this.rootBinding, relativePath,
        readable: input.readable !== false, writable: input.writable !== false } });
  }

  pathForResource(id: ResourceId, affordance: "read" | "write"): string {
    return this.boundPath(id, affordance);
  }

  pathForObservation(id: ResourceId): string {
    return this.boundPath(id);
  }

  private boundPath(id: ResourceId, affordance?: "read" | "write"): string {
    const record = this.resources.get(id);
    if (!record || record.kind !== "file" || record.source !== "filesystem_resolver" ||
      record.parentId !== this.directoryId ||
      record.metadata.rootBinding !== this.rootBinding ||
      (affordance && record.metadata[affordance === "read" ? "readable" : "writable"] !== true) ||
      typeof record.metadata.relativePath !== "string") {
      throw new FilesystemBoundaryError("FILE_RESOURCE_NOT_AUTHORIZED");
    }
    const relativePath = validateLogicalPath(record.metadata.relativePath);
    if (record.id !== mintResourceId("file", `workspace/${relativePath}`)) {
      throw new FilesystemBoundaryError("FILE_RESOURCE_MISMATCH");
    }
    return this.pathForRelative(relativePath, affordance !== "read");
  }

  private pathForRelative(relativePath: string, allowMissing: boolean): string {
    const target = resolve(this.root, relativePath);
    const rel = relative(this.root, target);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      throw new FilesystemBoundaryError("PATH_ESCAPES_WORKSPACE");
    }
    let cursor = this.root;
    const parts = relativePath.split("/");
    for (let index = 0; index < parts.length; index++) {
      cursor = join(cursor, parts[index]!);
      let info;
      try { info = lstatSync(cursor); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" &&
          allowMissing && index === parts.length - 1) break;
        throw new FilesystemBoundaryError("FILE_PATH_UNAVAILABLE");
      }
      if (info.isSymbolicLink()) throw new FilesystemBoundaryError("SYMLINK_DENIED");
      if (index < parts.length - 1 && !info.isDirectory()) {
        throw new FilesystemBoundaryError("PARENT_NOT_DIRECTORY");
      }
      if (index === parts.length - 1 && !info.isFile()) {
        throw new FilesystemBoundaryError("TARGET_NOT_REGULAR_FILE");
      }
      const actual = realpathSync(cursor);
      if (basename(actual) !== parts[index]) {
        throw new FilesystemBoundaryError("AMBIGUOUS_FILESYSTEM_CASE");
      }
      const actualRel = relative(this.root, actual);
      if (actualRel.startsWith("..") || isAbsolute(actualRel)) {
        throw new FilesystemBoundaryError("PATH_ESCAPES_WORKSPACE");
      }
    }
    return target;
  }
}
