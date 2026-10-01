import test from "node:test";
import assert from "node:assert/strict";
import { makeUiLaunchAgent } from "../src/mac-launch-agent.js";
test("macOS launch agent preserves spaces and escapes XML paths", () => {
  const result = makeUiLaunchAgent({ node: "/opt/node", project: "/Applications/AI & OS", logs: "/Users/test/Logs" });
  assert.ok(result.includes("/Applications/AI &amp; OS/src/ui-server.ts"));
  assert.ok(result.includes("<key>ThrottleInterval</key><integer>30</integer>"));
  assert.ok(result.includes("<string>/opt/node</string><string>--import</string>"));
  assert.throws(() => makeUiLaunchAgent({ node: "node", project: "/app", logs: "/logs" }));
  assert.throws(() => makeUiLaunchAgent({ node: "/node", project: "/app\n", logs: "/logs" }));
});
