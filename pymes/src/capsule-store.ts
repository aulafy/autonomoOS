import { defaultSpace, parseSpaceCommand, parseSpaceView, type SpaceSettings, type SpaceView, type SpaceDecision } from './space-contract.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { CapsuleRegistry } from './capsule-registry.js';
import { CapsuleError, capsuleText, capsuleRevision, parseCapsuleCommand, type CapsuleCatalog, type CapsuleInstallation, type CapsuleAudit } from './capsule-sdk.js';

/** Configuration journal, separate from C1-C12. All mutations and receipts commit atomically. */
export class CapsuleStore {
  private db: DatabaseSync;
  constructor(path: string, readonly tenant: string, readonly registry = new CapsuleRegistry(),
    private now: () => number = Date.now, private hooks: { beforeCommit?: () => void; afterCommit?: () => void } = {}) {
    capsuleText(tenant, 200);
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
      if (path !== ':memory:') chmodSync(path, 0o600);
      this.db.exec(`CREATE TABLE IF NOT EXISTS space_profiles(owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, settings TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS space_commands(owner TEXT NOT NULL, id TEXT NOT NULL, input TEXT NOT NULL, result TEXT NOT NULL, audit TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(owner,id));
        CREATE TABLE IF NOT EXISTS capsule_meta(tenant TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS capsule_owners(owner TEXT PRIMARY KEY, revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS capsule_installations(owner TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(owner,id));
        CREATE TABLE IF NOT EXISTS capsule_commands(owner TEXT NOT NULL, id TEXT NOT NULL, input TEXT NOT NULL, result TEXT NOT NULL, audit TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(owner,id));`);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const bound = this.db.prepare('SELECT tenant FROM capsule_meta').get();
        if (bound && bound.tenant !== tenant) throw new CapsuleError('CAPSULE_SCOPE_DENIED');
        if (!bound) this.db.prepare('INSERT INTO capsule_meta VALUES(?)').run(tenant);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    } catch (error) { this.db.close(); throw error; }
  }
  close(): void { this.db.close(); }
  private scope(tenant: string, owner: string) { if (tenant !== this.tenant) throw new CapsuleError('CAPSULE_SCOPE_DENIED'); capsuleText(owner, 200); }
  private revision(owner: string): number { return Number(this.db.prepare('SELECT revision FROM capsule_owners WHERE owner=?').get(owner)?.revision ?? 0); }
  catalog(tenant: string, owner: string): CapsuleCatalog {
    this.scope(tenant, owner);
    // A read transaction keeps the catalog revision, installations and audit coherent.
    this.db.exec('BEGIN');
    try {
      const result = { tenantId: tenant, ownerId: owner, revision: this.revision(owner),
        items: this.registry.list().map(manifest => {
          const row = this.db.prepare('SELECT value FROM capsule_installations WHERE owner=? AND id=?').get(owner, manifest.id);
          return { manifest, installation: row ? JSON.parse(String(row.value)) as CapsuleInstallation : null };
        }), audit: this.db.prepare('SELECT audit FROM capsule_commands WHERE owner=? ORDER BY revision DESC LIMIT 30').all(owner)
          .map(row => JSON.parse(String(row.audit)) as CapsuleAudit) };
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  space(tenant: string, owner: string): SpaceView {
    this.scope(tenant, owner); this.db.exec('BEGIN');
    try {
      const row = this.db.prepare('SELECT revision,settings FROM space_profiles WHERE owner=?').get(owner);
      const history = this.db.prepare('SELECT audit FROM space_commands WHERE owner=? ORDER BY revision DESC LIMIT 30').all(owner)
        .map(r => JSON.parse(String(r.audit)) as SpaceDecision);
      const view = parseSpaceView({ tenantId: tenant, ownerId: owner, revision: row ? Number(row.revision) : 0,
        configured: !!row, settings: row ? JSON.parse(String(row.settings)) : defaultSpace(), history }, tenant);
      this.db.exec('COMMIT'); return view;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  configureSpace(tenant: string, owner: string, raw: unknown): { tenantId: string; ownerId: string; revision: number; settings: SpaceSettings } {
    this.scope(tenant, owner); const input = parseSpaceCommand(raw), canonical = JSON.stringify(input);
    this.db.exec('BEGIN IMMEDIATE');
    let result: { tenantId: string; ownerId: string; revision: number; settings: SpaceSettings };
    try {
      const old = this.db.prepare('SELECT input,result FROM space_commands WHERE owner=? AND id=?').get(owner, input.commandId);
      if (old) {
        if (old.input !== canonical) throw new CapsuleError('SPACE_COMMAND_CONFLICT');
        result = JSON.parse(String(old.result));
      } else {
        const row = this.db.prepare('SELECT revision FROM space_profiles WHERE owner=?').get(owner);
        const revision = Number(row?.revision ?? 0);
        if (revision !== input.expectedRevision) throw new CapsuleError('SPACE_REVISION_CONFLICT');
        const next = capsuleRevision(revision + 1), at = capsuleRevision(this.now());
        const settings: SpaceSettings = { name: input.name, templateId: input.templateId, modules: input.modules };
        result = { tenantId: tenant, ownerId: owner, revision: next, settings };
        const audit: SpaceDecision = { commandId: input.commandId, actor: owner, at, revision: next, settings };
        this.db.prepare('INSERT INTO space_profiles VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,settings=excluded.settings').run(owner, next, JSON.stringify(settings));
        this.db.prepare('INSERT INTO space_commands VALUES(?,?,?,?,?,?)').run(owner, input.commandId, canonical, JSON.stringify(result), JSON.stringify(audit), next);
      }
      this.hooks.beforeCommit?.(); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.hooks.afterCommit?.(); return result;
  }
  apply(tenant: string, owner: string, raw: unknown): { revision: number; installation: CapsuleInstallation } {
    this.scope(tenant, owner); const input = parseCapsuleCommand(raw);
    const canonical = JSON.stringify(input);
    this.db.exec('BEGIN IMMEDIATE');
    let result: { revision: number; installation: CapsuleInstallation };
    try {
      const previous = this.db.prepare('SELECT input,result FROM capsule_commands WHERE owner=? AND id=?').get(owner, input.commandId);
      if (previous) {
        if (previous.input !== canonical) throw new CapsuleError('CAPSULE_COMMAND_CONFLICT');
        result = JSON.parse(String(previous.result));
      } else {
        const manifest = this.registry.get(input.capsuleId);
        if (manifest.version !== input.version) throw new CapsuleError('CAPSULE_VERSION_CONFLICT');
        const revision = this.revision(owner);
        if (revision !== input.expectedRevision) throw new CapsuleError('CAPSULE_REVISION_CONFLICT');
        const at = this.now(); if (!Number.isSafeInteger(at) || at < 0) throw new CapsuleError('CAPSULE_INVALID_CLOCK');
        const installation: CapsuleInstallation = { id: manifest.id, version: manifest.version, enabled: input.enabled,
          grants: [...input.grants], config: input.config, updatedAt: at };
        result = { revision: revision + 1, installation };
        const audit: CapsuleAudit = { commandId: input.commandId, capsuleId: manifest.id, revision: result.revision,
          actor: owner, at, enabled: input.enabled, version: manifest.version };
        this.db.prepare('INSERT INTO capsule_owners VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision').run(owner, result.revision);
        this.db.prepare('INSERT INTO capsule_installations VALUES(?,?,?) ON CONFLICT(owner,id) DO UPDATE SET value=excluded.value').run(owner, manifest.id, JSON.stringify(installation));
        this.db.prepare('INSERT INTO capsule_commands VALUES(?,?,?,?,?,?)').run(owner, input.commandId, canonical, JSON.stringify(result), JSON.stringify(audit), result.revision);
      }
      this.hooks.beforeCommit?.(); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.hooks.afterCommit?.(); return result;
  }
}
