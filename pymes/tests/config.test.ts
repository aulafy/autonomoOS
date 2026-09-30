import assert from "node:assert/strict";
import test from "node:test";
import { connectorStatuses, isConnectorConfig, isConnectorStatus, normalizeBootstrapIdentity, normalizeBootstrapToken, normalizeOptionalToken, parseBoundedOptionalNumber, parseConfiguredChannels, parseConfiguredIdSet, parseCorsOrigins, pilotConfig } from "../src/config.js";

test("pilot configuration declares the supported communication channels", () => {
  assert.deepEqual(pilotConfig.channels, ["whatsapp", "telegram", "imessage", "email"]);
  assert.equal(pilotConfig.crm.status, "lectura preparada");
  assert.equal(pilotConfig.calendar.status, "lectura preparada");
  assert.equal(pilotConfig.crm.id, "holded");
  assert.equal(pilotConfig.calendar.id, "google_calendar");
  assert.deepEqual(connectorStatuses, ["lectura preparada", "conectado", "no configurado"]);
  assert.equal(isConnectorStatus("conectado"), true);
  assert.equal(isConnectorStatus("inventado"), false);
  assert.equal(isConnectorStatus(null), false);
  assert.equal(isConnectorStatus(42), false);
  assert.equal(isConnectorStatus({ status: "conectado" }), false);
  assert.equal(isConnectorConfig(pilotConfig.crm), true);
  assert.equal(isConnectorConfig({ id: "x", name: "X", status: "invalid" }), false);
});

test("connector configuration rejects unsafe or oversized text", () => {
  assert.equal(isConnectorConfig({ id: "holded\n", name: "Holded", status: "lectura preparada" }), false);
  assert.equal(isConnectorConfig({ id: " ", name: "Holded", status: "lectura preparada" }), false);
  assert.equal(isConnectorConfig({ id: "h".repeat(201), name: "Holded", status: "lectura preparada" }), false);
});

test("configured channels discard unknown values and whitespace", () => {
  assert.deepEqual([...parseConfiguredChannels(" whatsapp,unknown, imessage ")], ["whatsapp", "imessage"]);
  assert.deepEqual([...parseConfiguredChannels("unknown")], []);
});

test("missing channel configuration uses the supported defaults", () => {
  assert.deepEqual([...parseConfiguredChannels(undefined)], ["whatsapp", "telegram", "imessage", "email"]);
  assert.deepEqual([...parseConfiguredChannels("   ")], ["whatsapp", "telegram", "imessage", "email"]);
});

test("configured channels are deduplicated", () => {
  assert.deepEqual([...parseConfiguredChannels("email,email,whatsapp")], ["email", "whatsapp"]);
});

test("bootstrap token normalization trims and enforces minimum length", () => {
  assert.equal(normalizeBootstrapToken("  1234567890123456  "), "1234567890123456");
  assert.throws(() => normalizeBootstrapToken("short"), /PYMES_API_BOOTSTRAP_TOKEN_REQUIRED/);
  assert.throws(() => normalizeBootstrapToken(undefined), /PYMES_API_BOOTSTRAP_TOKEN_REQUIRED/);
  assert.throws(() => normalizeBootstrapToken("x".repeat(4097)), /PYMES_API_BOOTSTRAP_TOKEN_REQUIRED/);
});

test("optional token normalization allows omission and rejects short values", () => {
  assert.equal(normalizeOptionalToken(undefined, "INVALID_INGRESS"), undefined);
  assert.equal(normalizeOptionalToken("  sixteen-character-token  ", "INVALID_INGRESS"), "sixteen-character-token");
  assert.throws(() => normalizeOptionalToken("short", "INVALID_INGRESS"), /INVALID_INGRESS/);
  assert.throws(() => normalizeOptionalToken("x".repeat(4097), "INVALID_INGRESS"), /INVALID_INGRESS/);
});

test("bounded optional numbers support ingress configuration", () => {
  assert.equal(parseBoundedOptionalNumber(undefined, 100, "ERR"), undefined);
  assert.equal(parseBoundedOptionalNumber(" 42 ", 100, "ERR"), 42);
  assert.throws(() => parseBoundedOptionalNumber("101", 100, "ERR"), /ERR/);
  assert.throws(() => parseBoundedOptionalNumber("nope", 100, "ERR"), /ERR/);
});

test("bootstrap identities are trimmed and bounded", () => {
  assert.equal(normalizeBootstrapIdentity("  agencia  ", "fallback"), "agencia");
  assert.equal(normalizeBootstrapIdentity(undefined, "fallback"), "fallback");
  assert.throws(() => normalizeBootstrapIdentity("   ", ""), /INVALID_PYMES_API_BOOTSTRAP_IDENTITY/);
  assert.throws(() => normalizeBootstrapIdentity("x".repeat(201), "fallback"), /INVALID_PYMES_API_BOOTSTRAP_IDENTITY/);
});

test("configured ingress id lists are bounded and deduplicated", () => {
  assert.deepEqual([...parseConfiguredIdSet(" agent-1, agent-1, resource-2 ")], ["agent-1", "resource-2"]);
  assert.throws(() => parseConfiguredIdSet(Array.from({ length: 101 }, (_, index) => `id-${index}`).join(",")), /INVALID_PYMES_ID_LIST/);
  assert.throws(() => parseConfiguredIdSet("x".repeat(201)), /INVALID_PYMES_ID_LIST/);
  assert.throws(() => parseConfiguredIdSet("agent-1\nagent-2"), /INVALID_PYMES_ID_LIST/);
});

test("CORS origins use safe defaults and reject wildcard", () => {
  assert.deepEqual(parseCorsOrigins(undefined), ["http://127.0.0.1:5174", "http://localhost:5174"]);
  assert.deepEqual(parseCorsOrigins(" https://agency.example, https://agency.example "), ["https://agency.example"]);
  assert.deepEqual(parseCorsOrigins("https://agency.example/"), ["https://agency.example"]);
  assert.deepEqual(parseCorsOrigins(",,,"), ["http://127.0.0.1:5174", "http://localhost:5174"]);
  assert.throws(() => parseCorsOrigins("*"), /INVALID_PYMES_API_CORS_ORIGINS/);
  assert.throws(() => parseCorsOrigins("ftp://agency.example"), /INVALID_PYMES_API_CORS_ORIGINS/);
  assert.throws(() => parseCorsOrigins("https://user:pass@agency.example"), /INVALID_PYMES_API_CORS_ORIGINS/);
  assert.throws(() => parseCorsOrigins(`https://${"a".repeat(2_050)}.example`), /INVALID_PYMES_API_CORS_ORIGINS/);
});
