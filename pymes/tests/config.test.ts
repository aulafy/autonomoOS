import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBootstrapToken, parseConfiguredChannels, parseCorsOrigins, pilotConfig } from "../src/config.js";

test("pilot configuration declares the supported communication channels", () => {
  assert.deepEqual(pilotConfig.channels, ["whatsapp", "telegram", "imessage", "email"]);
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
