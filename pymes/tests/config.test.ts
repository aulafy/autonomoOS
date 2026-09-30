import assert from "node:assert/strict";
import test from "node:test";
import { parseConfiguredChannels, pilotConfig } from "../src/config.js";

test("pilot configuration declares the supported communication channels", () => {
  assert.deepEqual(pilotConfig.channels, ["whatsapp", "telegram", "imessage", "email"]);
});

test("configured channels discard unknown values and whitespace", () => {
  assert.deepEqual([...parseConfiguredChannels(" whatsapp,unknown, imessage ")], ["whatsapp", "imessage"]);
});
