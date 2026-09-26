import { RESOURCE_KIND_BY_PREFIX, RESOURCE_PREFIX_BY_KIND, type ResourceKind } from "./kinds.js";

export type ResourceId = string & { readonly __resourceIdBrand: unique symbol };
const RESOURCE_ID_RE = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._~/-]*$/;

function hasForbiddenSegments(path: string): boolean {
  return path.split("/").some(segment =>
    segment === "." || segment === ".." || segment.length === 0
  );
}

export function normalizeResourcePath(input: string): string {
  return input.normalize("NFKC").trim().replace(/\\/g, "/")
    .replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function looksLikeResourceIdSyntax(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9-]*:/.test(value.trim());
}

export function isCanonicalResourceId(value: string): value is ResourceId {
  if (value !== value.toLowerCase() || !RESOURCE_ID_RE.test(value)) return false;
  const colon = value.indexOf(":");
  const prefix = value.slice(0, colon);
  const path = value.slice(colon + 1);
  return Boolean(RESOURCE_KIND_BY_PREFIX[prefix]) && !hasForbiddenSegments(path);
}

export function parseResourceId(value: string): ResourceId {
  if (!isCanonicalResourceId(value)) throw new Error(`invalid_resource_id:${value}`);
  return value;
}

export function mintResourceId(kind: ResourceKind, path: string): ResourceId {
  const normalized = normalizeResourcePath(path);
  if (!normalized || hasForbiddenSegments(normalized)) {
    throw new Error(`invalid_resource_path:${path}`);
  }
  return parseResourceId(`${RESOURCE_PREFIX_BY_KIND[kind]}:${normalized}`);
}

export function kindFromResourceId(id: ResourceId): ResourceKind {
  return RESOURCE_KIND_BY_PREFIX[id.slice(0, id.indexOf(":"))];
}

export function resourcePath(id: ResourceId): string {
  return id.slice(id.indexOf(":") + 1);
}
