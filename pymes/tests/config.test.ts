import assert from "node:assert/strict";
import test from "node:test";
import { pilotConfig } from "../src/config.js";

test("pilot configuration declares the supported communication channels", () => {
  assert.deepEqual(pilotConfig.channels, ["whatsapp", "telegram", "imessage", "email"]);
});
